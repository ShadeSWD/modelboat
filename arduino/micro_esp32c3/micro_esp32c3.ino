/*
 * «Микро» — двухвальный катер 350–450 мм без руля.
 * Плата: ESP32-C3 SuperMini. Драйвер: MX1508. Моторы: 2 × N20 (6 В, 1:10).
 * Питание: 1 × 18650 через плату защиты TP4056.
 *
 * Связь: Bluetooth LE, сервис Nordic UART (NUS). Протокол — текстовые
 * строки, завершаются '\n' (см. страницу «Электроника и прошивка»):
 *   "T<левый>,<правый>\n"  — тяга валов, каждая −100…100 (проценты);
 *   "S\n"                  — немедленный стоп;
 * телеметрия от лодки: "V<милливольты батареи>\n" раз в 2 с.
 *
 * Защиты: failsafe (нет команд 1000 мс — стоп), плавный разгон (slew rate),
 * ограничение тяги при разряде батареи ниже порога.
 *
 * Среда: Arduino IDE + ядро esp32 (Espressif), плата «ESP32C3 Dev Module»,
 * USB CDC On Boot: Enabled. Используются только штатные средства ядра:
 * библиотека BLE из комплекта ядра, analogWrite (ШИМ через LEDC),
 * analogReadMilliVolts (калиброванный АЦП).
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

/* ---------- выводы (без страповых GPIO2/8/9 платы C3) ---------- */
const int PIN_L_IN1 = 4;   // MX1508 IN1 — левый мотор, «вперёд»
const int PIN_L_IN2 = 5;   // MX1508 IN2 — левый мотор, «назад»
const int PIN_R_IN1 = 6;   // MX1508 IN3 — правый мотор, «вперёд»
const int PIN_R_IN2 = 7;   // MX1508 IN4 — правый мотор, «назад»
const int PIN_VBAT  = 3;   // делитель 100к/100к от плюса батареи (АЦП)
const int PIN_LED   = 8;   // светодиод платы (активный уровень — LOW)

/* ---------- настройки ---------- */
const unsigned long FAILSAFE_MS  = 1000; // нет команд дольше — стоп
const unsigned long TICK_MS      = 20;   // период цикла управления
const unsigned long VBAT_MS      = 2000; // период телеметрии напряжения
const int  SLEW_STEP    = 8;    // прирост ШИМ за такт (0…255): разгон ~0,6 с
const int  VBAT_LOW_MV  = 3300; // ниже — ограничить тягу (Li-ion почти пуст)
const int  VBAT_OK_MV   = 3450; // выше — снять ограничение (гистерезис)
const int  LOW_CAP_PCT  = 40;   // потолок тяги на разряженной батарее, %

/* ---------- UUID Nordic UART Service ---------- */
#define NUS_SERVICE "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_RX      "6e400002-b5a3-f393-e0a9-e50e24dcca9e" // телефон -> лодка
#define NUS_TX      "6e400003-b5a3-f393-e0a9-e50e24dcca9e" // лодка -> телефон

/* ---------- состояние ---------- */
BLECharacteristic *txChar = nullptr;
volatile bool connected = false;

int tgtL = 0, tgtR = 0;    // желаемая тяга, −100…100
int curL = 0, curR = 0;    // текущий ШИМ со знаком, −255…255
bool lowBatt = false;
unsigned long lastCmdMs = 0, lastTickMs = 0, lastVbatMs = 0;

char lineBuf[32];
size_t lineLen = 0;

/* ---------- разбор строки протокола ---------- */
int clampPct(long v) {
  if (v < -100) return -100;
  if (v > 100) return 100;
  return (int)v;
}

void handleLine(const char *s) {
  if (s[0] == 'S') {                 // стоп
    tgtL = 0; tgtR = 0;
    lastCmdMs = millis();
    return;
  }
  if (s[0] == 'T') {                 // T<левый>,<правый>
    char *end = nullptr;
    long a = strtol(s + 1, &end, 10);
    if (end == s + 1 || *end != ',') return;   // повреждённая строка
    char *end2 = nullptr;
    long b = strtol(end + 1, &end2, 10);
    if (end2 == end + 1) return;
    tgtL = clampPct(a);
    tgtR = clampPct(b);
    lastCmdMs = millis();
  }
}

void feedByte(char c) {              // накапливаем строку до '\n'
  if (c == '\n' || c == '\r') {
    if (lineLen > 0) {
      lineBuf[lineLen] = '\0';
      handleLine(lineBuf);
      lineLen = 0;
    }
    return;
  }
  if (lineLen < sizeof(lineBuf) - 1) lineBuf[lineLen++] = c;
  else lineLen = 0;                  // переполнение — строку отбрасываем
}

/* ---------- BLE-обработчики ---------- */
class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    connected = true;
    digitalWrite(PIN_LED, LOW);      // светодиод горит — связь есть
  }
  void onDisconnect(BLEServer *srv) override {
    connected = false;
    tgtL = 0; tgtR = 0;              // обрыв связи — стоп
    digitalWrite(PIN_LED, HIGH);
    srv->startAdvertising();         // снова видимы для подключения
  }
};

class RxCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *ch) override {
    const uint8_t *d = ch->getData();
    size_t n = ch->getLength();
    for (size_t i = 0; i < n; i++) feedByte((char)d[i]);
  }
};

/* ---------- моторы ---------- */
/* Один канал MX1508: вперёд — ШИМ на IN1, ноль на IN2; назад — наоборот. */
void applyMotor(int pin1, int pin2, int pwm) {
  if (pwm >= 0) {
    analogWrite(pin2, 0);
    analogWrite(pin1, pwm);
  } else {
    analogWrite(pin1, 0);
    analogWrite(pin2, -pwm);
  }
}

/* шаг плавного разгона: current тянется к target не быстрее SLEW_STEP */
int slew(int current, int target) {
  if (current < target) {
    current += SLEW_STEP;
    if (current > target) current = target;
  } else if (current > target) {
    current -= SLEW_STEP;
    if (current < target) current = target;
  }
  return current;
}

/* ---------- батарея ---------- */
int readBatteryMv() {
  // делитель 100к/100к: на выводе — половина напряжения батареи
  long mv = 0;
  for (int i = 0; i < 4; i++) mv += analogReadMilliVolts(PIN_VBAT);
  return (int)(mv / 4 * 2);
}

void setup() {
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);
  pinMode(PIN_L_IN1, OUTPUT); pinMode(PIN_L_IN2, OUTPUT);
  pinMode(PIN_R_IN1, OUTPUT); pinMode(PIN_R_IN2, OUTPUT);
  applyMotor(PIN_L_IN1, PIN_L_IN2, 0);
  applyMotor(PIN_R_IN1, PIN_R_IN2, 0);

  Serial.begin(115200);              // отладка по USB (не обязательна)

  BLEDevice::init("ModelBoat-Micro");
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCB());

  BLEService *svc = server->createService(NUS_SERVICE);
  txChar = svc->createCharacteristic(NUS_TX, BLECharacteristic::PROPERTY_NOTIFY);
  txChar->addDescriptor(new BLE2902());
  BLECharacteristic *rxChar = svc->createCharacteristic(
    NUS_RX,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rxChar->setCallbacks(new RxCB());
  svc->start();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE);  // пульт фильтрует устройства по NUS
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();

  lastCmdMs = millis();
}

void loop() {
  unsigned long now = millis();

  /* failsafe: команд нет дольше секунды — глушим моторы */
  if (now - lastCmdMs > FAILSAFE_MS) { tgtL = 0; tgtR = 0; }

  /* телеметрия и контроль разряда */
  if (now - lastVbatMs >= VBAT_MS) {
    lastVbatMs = now;
    int mv = readBatteryMv();
    if (mv < VBAT_LOW_MV) lowBatt = true;
    else if (mv > VBAT_OK_MV) lowBatt = false;
    if (connected && txChar) {
      char msg[16];
      snprintf(msg, sizeof(msg), "V%d\n", mv);
      txChar->setValue((uint8_t *)msg, strlen(msg));
      txChar->notify();
    }
  }

  /* цикл управления с плавным разгоном */
  if (now - lastTickMs >= TICK_MS) {
    lastTickMs = now;
    int cap = lowBatt ? LOW_CAP_PCT : 100;     // потолок тяги, %
    int wantL = constrain(tgtL, -cap, cap) * 255 / 100;
    int wantR = constrain(tgtR, -cap, cap) * 255 / 100;
    curL = slew(curL, wantL);
    curR = slew(curR, wantR);
    applyMotor(PIN_L_IN1, PIN_L_IN2, curL);
    applyMotor(PIN_R_IN1, PIN_R_IN2, curR);
  }
}

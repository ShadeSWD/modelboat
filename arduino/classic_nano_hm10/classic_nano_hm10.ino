/*
 * «Классика» — одновальное судно 450–600 мм с рулём.
 * Плата: Arduino Nano (ATmega328P). Связь: BLE-модуль HM-10 (FFE0/FFE1).
 * Драйвер: MX1508 (оба канала запараллелены на один мотор класса 130).
 * Руль: серво SG90. Питание: 2 × 18650 (6,0–8,4 В), логика и серво — 5 В
 * от понижающего преобразователя mini-360.
 *
 * Протокол — текстовые строки, завершаются '\n':
 *   "M<газ>,<руль>\n" — газ −100…100 %, руль −100…100 % (минус — влево);
 *   "S\n"             — немедленный стоп (газ 0, руль прямо);
 * телеметрия: "V<милливольты батареи>\n" раз в 2 с.
 *
 * Защиты: failsafe 1000 мс, плавный разгон, потолок ШИМ ~70 % (мотор 3–6 В
 * на батарее 8,4 В), ограничение тяги при разряде ниже 3,2 В на банку.
 *
 * Подключение HM-10: TX модуля -> D10 (напрямую), D11 -> RX модуля через
 * делитель 1 кОм / 2 кОм (вход модуля трёхвольтовый!).
 */

#include <SoftwareSerial.h>
#include <Servo.h>

/* ---------- выводы ---------- */
const int PIN_BT_RX   = 10;  // слушаем TX модуля HM-10
const int PIN_BT_TX   = 11;  // говорим в RX модуля (через делитель!)
const int PIN_M_IN1   = 5;   // MX1508 IN1 (+IN3) — «вперёд» (ШИМ таймера 0)
const int PIN_M_IN2   = 6;   // MX1508 IN2 (+IN4) — «назад»  (ШИМ таймера 0)
const int PIN_SERVO   = 9;   // сигнал серво руля (Servo.h, таймер 1)
const int PIN_VBAT    = A0;  // делитель 10 кОм / 4,7 кОм от плюса батареи

/* ---------- настройки ---------- */
const unsigned long FAILSAFE_MS = 1000; // нет команд дольше — стоп
const unsigned long TICK_MS     = 20;   // период цикла управления
const unsigned long VBAT_MS     = 2000; // период телеметрии
const int SLEW_STEP   = 6;     // прирост ШИМ за такт: полный газ за ~0,6 с
const int PWM_MAX     = 180;   // потолок ШИМ: 8,4 В * 180/255 ≈ 5,9 В на моторе
const int VBAT_LOW_MV = 6400;  // 2 банки по 3,2 В — батарея почти пуста
const int VBAT_OK_MV  = 6700;  // гистерезис снятия ограничения
const int LOW_CAP_PCT = 40;    // потолок газа на разряженной батарее, %
const int RUD_RANGE   = 36;    // отклонение серво от середины, град (на 100 %)

/* делитель напряжения: R1 = 10 кОм (вверх), R2 = 4,7 кОм (вниз) */
const float VBAT_K = 5.0 / 1023.0 * (10.0 + 4.7) / 4.7 * 1000.0; // АЦП -> мВ

SoftwareSerial bt(PIN_BT_RX, PIN_BT_TX);
Servo rudder;

/* ---------- состояние ---------- */
int tgtThr = 0, tgtRud = 0;   // команды с пульта, −100…100
int curPwm = 0;               // текущий ШИМ мотора со знаком, −PWM_MAX…PWM_MAX
bool lowBatt = false;
unsigned long lastCmdMs = 0, lastTickMs = 0, lastVbatMs = 0;

char lineBuf[32];
byte lineLen = 0;

/* ---------- разбор строки протокола ---------- */
int clampPct(long v) {
  if (v < -100) return -100;
  if (v > 100) return 100;
  return (int)v;
}

void handleLine(const char *s) {
  if (s[0] == 'S') {                       // стоп
    tgtThr = 0; tgtRud = 0;
    lastCmdMs = millis();
    return;
  }
  if (s[0] == 'M') {                       // M<газ>,<руль>
    char *end = NULL;
    long a = strtol(s + 1, &end, 10);
    if (end == s + 1 || *end != ',') return;
    char *end2 = NULL;
    long b = strtol(end + 1, &end2, 10);
    if (end2 == end + 1) return;
    tgtThr = clampPct(a);
    tgtRud = clampPct(b);
    lastCmdMs = millis();
  }
}

void feedByte(char c) {
  if (c == '\n' || c == '\r') {
    if (lineLen > 0) {
      lineBuf[lineLen] = '\0';
      handleLine(lineBuf);
      lineLen = 0;
    }
    return;
  }
  if (lineLen < sizeof(lineBuf) - 1) lineBuf[lineLen++] = c;
  else lineLen = 0;                        // переполнение — отбрасываем
}

/* ---------- мотор на запараллеленном MX1508 ---------- */
void applyMotor(int pwm) {
  if (pwm >= 0) {
    analogWrite(PIN_M_IN2, 0);
    analogWrite(PIN_M_IN1, pwm);
  } else {
    analogWrite(PIN_M_IN1, 0);
    analogWrite(PIN_M_IN2, -pwm);
  }
}

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

int readBatteryMv() {
  long a = 0;
  for (byte i = 0; i < 4; i++) a += analogRead(PIN_VBAT);
  return (int)(a / 4 * VBAT_K);
}

void setup() {
  pinMode(PIN_M_IN1, OUTPUT);
  pinMode(PIN_M_IN2, OUTPUT);
  applyMotor(0);
  rudder.attach(PIN_SERVO);
  rudder.write(90);                        // руль прямо

  Serial.begin(115200);                    // отладка по USB
  bt.begin(9600);                          // заводская скорость HM-10

  lastCmdMs = millis();
}

void loop() {
  unsigned long now = millis();

  /* приём команд: и с HM-10, и с USB (удобно для наладки без телефона) */
  while (bt.available()) feedByte((char)bt.read());
  while (Serial.available()) feedByte((char)Serial.read());

  /* failsafe: связь пропала — стоп, руль прямо */
  if (now - lastCmdMs > FAILSAFE_MS) { tgtThr = 0; tgtRud = 0; }

  /* телеметрия и контроль разряда */
  if (now - lastVbatMs >= VBAT_MS) {
    lastVbatMs = now;
    int mv = readBatteryMv();
    if (mv < VBAT_LOW_MV) lowBatt = true;
    else if (mv > VBAT_OK_MV) lowBatt = false;
    bt.print('V'); bt.print(mv); bt.print('\n');
  }

  /* цикл управления */
  if (now - lastTickMs >= TICK_MS) {
    lastTickMs = now;
    int cap = lowBatt ? LOW_CAP_PCT : 100;
    int thr = constrain(tgtThr, -cap, cap);
    int want = (int)((long)thr * PWM_MAX / 100);
    curPwm = slew(curPwm, want);
    applyMotor(curPwm);
    /* руль без сглаживания: серво сама ограничивает скорость */
    rudder.write(90 + (int)((long)tgtRud * RUD_RANGE / 100));
  }
}

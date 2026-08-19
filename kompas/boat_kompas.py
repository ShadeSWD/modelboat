# -*- coding: utf-8 -*-
"""boat_kompas.py — построение нативных моделей КОМПАС-3D по файлу boat.json
из браузерного конструктора сайта «Модель судна для 3D-печати».

Что строится (файлы кладутся рядом с boat.json):
  * <имя>_корпус.m3d   — деталь корпуса: лофт («по сечениям») по 21 шпангоуту,
                          оболочка толщиной wall с открытой палубой,
                          отверстие под дейдвуд по линии вала;
  * <имя>_руль.m3d     — перо руля (скруглённая пластина chord x span x thick);
  * <имя>_дейдвуд.m3d  — дейдвудная труба (по каждой линии вала);
  * <ид>.m3d           — болванки компонентов (плата, мотор, батарея, серво)
                          по полю components: параллелепипед или цилиндр;
  * <имя>_сборка.a3d   — сборка: все детали вставлены на свои места.

Запуск (Windows с установленным КОМПАС-3D v20+ и pywin32):
    python boat_kompas.py [путь\к\boat.json]
Без аргумента берётся boat.json из каталога скрипта. Работает и из
встроенной библиотеки «КОМПАС-Макро» (там pythonwin уже есть).

ЧЕСТНОЕ ПРЕДУПРЕЖДЕНИЕ. Макрос написан по документации API7 КОМПАС-3D
(интерфейсы IApplication, IKompasDocument3D, IPart7, ISketch, ILoftedBoss,
IShellOperation и т.д.) и НЕ прогонялся на живом КОМПАС — под рукой не было
Windows. Имена отдельных интерфейсов/свойств могли разойтись с вашей версией
SDK (они менялись между v17...v22): возможны мелкие правки. Каждая логическая
часть вынесена в отдельную функцию с комментарием, что она делает и какими
интерфейсами пользуется, — чинить должно быть просто. Сверяйтесь с
«SDK\Справочник API7» вашей поставки (файл ksAPI7.chm).
"""

import json
import math
import os
import sys
import traceback

# ---------------------------------------------------------------------------
# Подключение COM. pythoncom/win32com входят в pywin32; в поставке КОМПАС
# «Библиотеки Python» (КОМПАС-Макро) они уже установлены.
# ---------------------------------------------------------------------------
try:
    import pythoncom
    from win32com.client import Dispatch, gencache
except ImportError:  # запуск не на Windows / без pywin32
    print('Нужен пакет pywin32 (pip install pywin32) и Windows с КОМПАС-3D.')
    raise

# ---------------------------------------------------------------------------
# Константы API КОМПАС (из ksConstants / ksConstants3D; значения — из
# документации SDK, чтобы не зависеть от модулей констант).
# ---------------------------------------------------------------------------
DOC_PART = 4          # ksDocumentPart      — документ-деталь (*.m3d)
DOC_ASSEMBLY = 5      # ksDocumentAssembly  — документ-сборка (*.a3d)

# Стандартные объекты детали (ksObj3dTypeEnum)
O3D_PLANE_XOY = 1     # o3d_planeXOY
O3D_PLANE_XOZ = 2     # o3d_planeXOZ
O3D_PLANE_YOZ = 3     # o3d_planeYOZ

# Направление операции выдавливания (ksDirectionTypeEnum)
DIR_NORMAL = 0        # dtNormal   — в прямом направлении
DIR_REVERSE = 1       # dtReverse  — в обратном
DIR_BOTH = 2          # dtBoth     — в обе стороны

# ---------------------------------------------------------------------------
# Размеры, которых нет в boat.json (дейдвуд и вал) — правьте под свой набор.
# ---------------------------------------------------------------------------
DEADWOOD_OD = 6.0     # наружный диаметр дейдвудной трубы, мм
DEADWOOD_ID = 3.2     # внутренний (под вал 3 мм со смазкой), мм
HULL_HOLE_D = 6.4     # диаметр отверстия в корпусе под трубу (посадка), мм


# ===========================================================================
# 1. Чтение и проверка boat.json
# ===========================================================================
def read_boat(path):
    """Читает boat.json и проверяет обязательные поля схемы.
    Возвращает словарь; при нарушении схемы — ValueError с внятным текстом."""
    with open(path, encoding='utf-8') as fh:
        boat = json.load(fh)

    for key in ('name', 'L', 'B', 'T', 'D', 'wall', 'stations',
                'deck', 'components', 'shaftLine'):
        if key not in boat:
            raise ValueError('в boat.json нет обязательного поля "%s"' % key)
    if not boat['stations']:
        raise ValueError('пустой список шпангоутов stations')
    for st in boat['stations']:
        if 'x' not in st or not st.get('points'):
            raise ValueError('шпангоут без x или points: %r' % st)
        if len(st['points']) < 3:
            raise ValueError('шпангоут x=%s: меньше 3 точек' % st['x'])
    # шпангоуты должны идти по возрастанию x — так строится лофт
    xs = [st['x'] for st in boat['stations']]
    if xs != sorted(xs):
        boat['stations'] = sorted(boat['stations'], key=lambda s: s['x'])
    return boat


# ===========================================================================
# 2. Подключение к КОМПАС (API7 через COM)
# ===========================================================================
def get_kompas():
    """Запускает (или подхватывает запущенный) КОМПАС-3D и возвращает пару
    (module, app): типизированный модуль API7 и интерфейс IApplication."""
    # CLSID библиотеки типов KompasAPI7 — одинаков для v17...v22
    module = gencache.EnsureModule(
        '{69AC2981-37C0-4379-84FD-5DD2F3C0A520}', 0, 1, 0)
    app = module.IApplication(
        Dispatch('Kompas.Application.7')._oleobj_.QueryInterface(
            module.IApplication.CLSID, pythoncom.IID_IDispatch))
    app.Visible = True
    app.HideMessage = True   # не задавать вопросов диалогами
    return module, app


def new_part(module, app):
    """Создаёт документ-деталь. Возвращает (doc3d, part):
    IKompasDocument3D и его TopPart (IPart7)."""
    doc = app.Documents.Add(DOC_PART, True)     # True = видимым
    doc3d = module.IKompasDocument3D(doc)
    return doc3d, doc3d.TopPart


def save_doc(doc3d, path):
    """Сохраняет документ под именем path (перезаписывая существующий)."""
    if os.path.exists(path):
        os.remove(path)
    doc3d.SaveAs(path)
    print('  сохранено: %s' % path)


# ===========================================================================
# 3. Эскизы. Все эскизы шпангоутов лежат на плоскостях, параллельных YOZ
#    (смещение = x шпангоута): ось X детали = ось корпуса от транца к носу,
#    оси эскиза соответствуют (y, z) из boat.json.
# ===========================================================================
def offset_plane(module, part, x):
    """Вспомогательная плоскость: YOZ, смещённая на x вдоль оси X."""
    container = module.IModelContainer(part)
    planes = container.PlaneOffsets
    plane = planes.Add()
    plane.Plane = part.DefaultObject(O3D_PLANE_YOZ)
    plane.Direction = True                       # в сторону +X
    plane.Offset = float(x)
    plane.Hidden = True                          # не засорять дерево экраном
    plane.Update()
    return plane


def begin_sketch(module, part, plane):
    """Создаёт эскиз на плоскости и открывает его на редактирование.
    Возвращает (sketch, draw): ISketch и IDrawingContainer для 2D-геометрии."""
    container = module.IModelContainer(part)
    sketch = container.Sketchs.Add()
    sketch.Plane = plane
    sketch.Update()
    doc2d = module.IKompasDocument2D(sketch.BeginEdit())
    view = doc2d.ViewsAndLayersManager.Views.View(0)   # системный вид эскиза
    draw = module.IDrawingContainer(view)
    return sketch, draw


def end_sketch(sketch):
    """Закрывает редактирование эскиза и перестраивает его."""
    sketch.EndEdit()
    sketch.Update()


def add_spline(draw, pts, closed=False):
    """Сплайн по точкам (кривая Безье через точки; в терминах КОМПАС —
    «Сплайн по точкам»). pts — список пар (u, v) в осях эскиза."""
    spline = draw.Beziers.Add()
    for i, (u, v) in enumerate(pts):
        # AddPoint(index, x, y); -1 = в конец — оставлено индексом для ясности
        spline.AddPoint(i, float(u), float(v))
    spline.Closed = bool(closed)
    spline.Style = 1                 # основная линия — участвует в операции
    spline.Update()
    return spline


def add_segment(draw, x1, y1, x2, y2):
    """Отрезок основной линией."""
    seg = draw.LineSegments.Add()
    seg.X1, seg.Y1, seg.X2, seg.Y2 = float(x1), float(y1), float(x2), float(y2)
    seg.Style = 1
    seg.Update()
    return seg


def add_circle(draw, xc, yc, d):
    """Окружность основной линией (диаметр d)."""
    c = draw.Circles.Add()
    c.Xc, c.Yc, c.Radius = float(xc), float(yc), float(d) / 2.0
    c.Style = 1
    c.Update()
    return c


# ===========================================================================
# 4. Деталь корпуса: эскизы шпангоутов -> лофт -> оболочка -> отверстие
#    под дейдвуд.
# ===========================================================================
def station_sketch(module, part, station):
    """Эскиз одного шпангоута: правая полуветвь по точкам из boat.json,
    зеркальная левая (y -> -y), замкнутый контур.

    В осях эскиза (плоскость || YOZ): первая ось = y (на правый борт),
    вторая = z (вверх). Если в вашей версии оси эскиза на YOZ смотрят
    иначе (например, первая ось = -y), поменяйте знак U ниже — это
    единственное место.
    """
    pts = [(float(p[0]), float(p[1])) for p in station['points']]
    plane = offset_plane(module, part, station['x'])
    sketch, draw = begin_sketch(module, part, plane)
    try:
        # правая полуветвь: киль -> палуба
        add_spline(draw, pts)
        # левая полуветвь: зеркало в ДП
        add_spline(draw, [(-u, v) for (u, v) in pts])
        # замыкание по палубе (полуветви уже сходятся в киле при y=0;
        # если у транца киль начинается не с y=0 — замкнётся и там)
        (u0, v0), (u1, v1) = pts[0], pts[-1]
        add_segment(draw, -u1, v1, u1, v1)          # палуба
        if abs(u0) > 1e-6:
            add_segment(draw, -u0, v0, u0, v0)      # низ (широкий транец)
    finally:
        end_sketch(sketch)
    return sketch


def loft_hull(module, part, sketches):
    """Операция «По сечениям» (лофт) по списку эскизов шпангоутов.
    Интерфейс ILoftedBoss из коллекции LoftedBosses контейнера модели."""
    container = module.IModelContainer(part)
    loft = container.LoftedBosses.Add()
    sections = loft.Sections                 # коллекция сечений лофта
    for sk in sketches:
        sections.Add(sk)
    loft.Closed = False                      # незамкнутый (нос-корма)
    loft.AutoPath = True                     # автоматическая траектория
    loft.Update()
    return loft


def find_deck_face(module, part, deck_z):
    """Ищет грань палубы: плоская грань тела с максимальным Z, близким к
    высоте борта deck_z. Обход граней — через IFeature7 тела.

    Это самое «хрупкое» место макроса: у разных версий API имена коллекции
    граней различаются (Faces / ModelFaces). При проблемах просто выполните
    оболочку вручную: операция «Оболочка», толщина wall, удалить верхнюю
    грань — и закомментируйте вызов shell_hull ниже.
    """
    body = part.Bodies(0) if callable(getattr(part, 'Bodies', None)) else None
    if body is None:
        return None
    feature = module.IFeature7(body)
    faces = feature.ModelObjects(6)          # 6 = o3d_face: все грани тела
    best, best_z = None, -1e9
    try:
        count = len(faces)
    except TypeError:
        count = faces.Count
    for i in range(count):
        face = faces[i]
        try:
            gab = face.Gabarit                 # габарит грани (X1..Z2)
            zmax = max(gab[2], gab[5])
        except Exception:
            continue
        if zmax > best_z:
            best, best_z = face, zmax
    # верхняя ли это грань палубы: допуск полмиллиметра
    if best is not None and abs(best_z - deck_z) < 0.5:
        return best
    return best


def shell_hull(module, part, wall, deck_z):
    """Оболочка толщиной wall с открытой палубой (удаляется верхняя грань).
    Интерфейс IShellOperation из коллекции ShellOperations."""
    container = module.IModelContainer(part)
    shell = container.ShellOperations.Add()
    shell.Thickness = float(wall)
    shell.Direction = False                  # толщина внутрь корпуса
    face = find_deck_face(module, part, deck_z)
    if face is not None:
        shell.Faces.Add(face)                # удаляемая (открытая) грань
    else:
        print('  ! грань палубы не найдена: оболочка построится замкнутой, '
              'откройте палубу вручную (операция «Оболочка»)')
    shell.Update()
    return shell


def cut_shaft_hole(module, part, seg, hole_d):
    """Отверстие под дейдвуд: вырез «по сечениям» между двумя окружностями
    диаметра hole_d на плоскостях x1 и x2 линии вала. Наклон вала в ДП
    получается сам собой — центры окружностей стоят на (y, z1) и (y, z2).

    Окружности чуть выдвинуты за пределы отрезка вала (на 2 мм по x),
    чтобы вырез гарантированно прошёл насквозь через обшивку."""
    x1, z1 = float(seg['x1']), float(seg['z1'])
    x2, z2 = float(seg['x2']), float(seg['z2'])
    y = float(seg.get('y', 0.0))
    # продление отрезка на 2 мм в обе стороны
    dx, dz = x2 - x1, z2 - z1
    ln = math.hypot(dx, dz) or 1.0
    ex, ez = 2.0 * dx / ln, 2.0 * dz / ln
    ends = [(x1 - ex, z1 - ez), (x2 + ex, z2 + ez)]

    sketches = []
    for (x, z) in ends:
        plane = offset_plane(module, part, x)
        sketch, draw = begin_sketch(module, part, plane)
        try:
            add_circle(draw, y, z, hole_d)
        finally:
            end_sketch(sketch)
        sketches.append(sketch)

    container = module.IModelContainer(part)
    cut = container.CutLofteds.Add()         # вырез по сечениям (ICutLofted)
    for sk in sketches:
        cut.Sections.Add(sk)
    cut.Update()
    return cut


def build_hull(module, app, boat, out_dir):
    """Собирает деталь корпуса целиком и сохраняет её. Возвращает путь."""
    print('Корпус: лофт по %d шпангоутам...' % len(boat['stations']))
    doc3d, part = new_part(module, app)
    part.Name = '%s — корпус' % boat['name']

    # 4.1 эскизы шпангоутов на смещённых плоскостях
    sketches = [station_sketch(module, part, st) for st in boat['stations']]

    # 4.2 лофт
    loft_hull(module, part, sketches)

    # 4.3 оболочка с открытой палубой
    shell_hull(module, part, boat['wall'], boat['D'])

    # 4.4 отверстия под дейдвуд(ы)
    for seg in boat['shaftLine']:
        try:
            cut_shaft_hole(module, part, seg, HULL_HOLE_D)
        except Exception:
            print('  ! отверстие под дейдвуд не построилось (постройте '
                  'вырезом вручную):\n%s' % traceback.format_exc(limit=1))

    path = os.path.join(out_dir, '%s_корпус.m3d' % safe_name(boat['name']))
    save_doc(doc3d, path)
    return path


# ===========================================================================
# 5. Перо руля: скруглённая пластина chord x span x thick.
#    Профиль в плане — «стадион»: прямоугольник с полукруглыми кромками,
#    выдавленный на span вверх.
# ===========================================================================
def build_rudder(module, app, boat, out_dir):
    r = boat.get('rudder')
    if not r:
        return None
    chord, span, thick = float(r['chord']), float(r['span']), float(r['thick'])
    print('Перо руля: %.0f x %.0f x %.0f мм...' % (chord, span, thick))

    doc3d, part = new_part(module, app)
    part.Name = '%s — перо руля' % boat['name']

    # эскиз профиля на плоскости XOY детали: ось X = хорда, ось Y = толщина
    sketch, draw = begin_sketch(module, part, part.DefaultObject(O3D_PLANE_XOY))
    try:
        h = thick / 2.0
        L = chord - thick                    # длина прямых участков
        # две прямые и две полуокружности («стадион»)
        add_segment(draw, 0.0, h, L, h)
        add_segment(draw, 0.0, -h, L, -h)
        for (xc, a1, a2) in ((0.0, 90.0, 270.0), (L, -90.0, 90.0)):
            arc = draw.Arcs.Add()
            arc.Xc, arc.Yc, arc.Radius = xc, 0.0, h
            arc.Angle1, arc.Angle2 = a1, a2
            arc.Direction = True
            arc.Style = 1
            arc.Update()
    finally:
        end_sketch(sketch)

    extrude(module, part, sketch, span)

    path = os.path.join(out_dir, '%s_руль.m3d' % safe_name(boat['name']))
    save_doc(doc3d, path)
    return path


# ===========================================================================
# 6. Дейдвудная труба: цилиндр OD x длина с осевым каналом ID.
#    Строится вдоль оси X детали; наклон по линии вала задаётся при
#    вставке в сборку (поворот вокруг оси Y).
# ===========================================================================
def build_deadwood(module, app, boat, idx, seg, out_dir):
    length = math.hypot(seg['x2'] - seg['x1'], seg['z2'] - seg['z1'])
    length += 8.0                            # выпуск наружу под сальник/винт
    print('Дейдвуд %d: длина %.1f мм...' % (idx + 1, length))

    doc3d, part = new_part(module, app)
    part.Name = '%s — дейдвуд %d' % (boat['name'], idx + 1)

    # труба: кольцо (две окружности) на YOZ, выдавливание вдоль X
    sketch, draw = begin_sketch(module, part, part.DefaultObject(O3D_PLANE_YOZ))
    try:
        add_circle(draw, 0.0, 0.0, DEADWOOD_OD)
        add_circle(draw, 0.0, 0.0, DEADWOOD_ID)
    finally:
        end_sketch(sketch)
    extrude(module, part, sketch, length)

    suffix = '' if len(boat['shaftLine']) == 1 else '_%d' % (idx + 1)
    path = os.path.join(out_dir,
                        '%s_дейдвуд%s.m3d' % (safe_name(boat['name']), suffix))
    save_doc(doc3d, path)
    return path


# ===========================================================================
# 7. Болванки компонентов: параллелепипед или цилиндр по shape.
#    Каждая деталь строится с центром габарита в НАЧАЛЕ координат детали —
#    так вставка в сборку сводится к переносу в (x, y, z) компонента.
# ===========================================================================
def _set_depth(ex, forward, value):
    """Глубина выдавливания. В разных версиях SDK это либо метод
    Depth(forward, value), либо свойства DepthNormal/DepthReverse —
    пробуем оба варианта."""
    try:
        ex.Depth(bool(forward), float(value))
    except (AttributeError, TypeError):
        if forward:
            ex.DepthNormal = float(value)
        else:
            ex.DepthReverse = float(value)


def extrude(module, part, sketch, depth, reverse=False):
    """Приклеить выдавливанием на глубину depth от плоскости эскиза."""
    container = module.IModelContainer(part)
    ex = container.Extrusions.Add()
    ex.Sketch = sketch
    ex.Direction = DIR_REVERSE if reverse else DIR_NORMAL
    _set_depth(ex, not reverse, depth)
    ex.Update()
    return ex


def build_component(module, app, comp, out_dir):
    """Болванка одного компонента. box: L вдоль X, W вдоль Y, H вдоль Z.
    cyl: ось вдоль X, диаметр W, длина L."""
    cid = comp['id']
    L, W, H = float(comp['L']), float(comp['W']), float(comp['H'])
    shape = comp.get('shape', 'box')
    print('Компонент %-14s (%s)...' % (cid, shape))

    doc3d, part = new_part(module, app)
    part.Name = comp.get('name', cid)

    if shape == 'cyl':
        # окружность диаметром W на YOZ, выдавливание симметрично по X
        sketch, draw = begin_sketch(module, part,
                                    part.DefaultObject(O3D_PLANE_YOZ))
        try:
            add_circle(draw, 0.0, 0.0, W)
        finally:
            end_sketch(sketch)
        ex = extrude_sym(module, part, sketch, L)
    else:
        # прямоугольник L x W на XOY, выдавливание симметрично по Z
        sketch, draw = begin_sketch(module, part,
                                    part.DefaultObject(O3D_PLANE_XOY))
        try:
            add_segment(draw, -L / 2, -W / 2, L / 2, -W / 2)
            add_segment(draw, L / 2, -W / 2, L / 2, W / 2)
            add_segment(draw, L / 2, W / 2, -L / 2, W / 2)
            add_segment(draw, -L / 2, W / 2, -L / 2, -W / 2)
        finally:
            end_sketch(sketch)
        ex = extrude_sym(module, part, sketch, H)

    path = os.path.join(out_dir, '%s.m3d' % safe_name(cid))
    save_doc(doc3d, path)
    return path


def extrude_sym(module, part, sketch, depth):
    """Выдавливание симметрично в обе стороны от плоскости эскиза —
    центр болванки остаётся в начале координат детали."""
    container = module.IModelContainer(part)
    ex = container.Extrusions.Add()
    ex.Sketch = sketch
    ex.Direction = DIR_BOTH
    _set_depth(ex, True, float(depth) / 2.0)
    _set_depth(ex, False, float(depth) / 2.0)
    ex.Update()
    return ex


# ===========================================================================
# 8. Сборка: вставка всех деталей с координатами из boat.json.
#    Матрица размещения — перенос + (для дейдвуда) поворот вокруг оси Y.
# ===========================================================================
def placement_matrix(tx, ty, tz, rot_y_deg=0.0):
    """Матрица 4x4 (строкой из 16 чисел, построчно): поворот вокруг Y
    на rot_y_deg, затем перенос (tx, ty, tz). Ось Y смотрит на правый борт,
    поэтому ПОЛОЖИТЕЛЬНЫЙ подъём вала к носу — поворот на -angle."""
    a = math.radians(rot_y_deg)
    c, s = math.cos(a), math.sin(a)
    return (c, 0.0, -s, 0.0,
            0.0, 1.0, 0.0, 0.0,
            s, 0.0, c, 0.0,
            float(tx), float(ty), float(tz), 1.0)


def insert_part(module, asm_part, path, matrix):
    """Вставляет деталь path в сборку и ставит по матрице размещения.
    IParts7.AddFromFile + IPlacement3D.InitByMatrix3D."""
    inserted = asm_part.Parts.AddFromFile(path, True, False)
    placement = inserted.Placement
    placement.InitByMatrix3D(matrix)
    inserted.UpdatePlacement(True)           # зафиксировать позицию
    return inserted


def build_assembly(module, app, boat, files, out_dir):
    """Сборка *.a3d: корпус и руль — в нулях (их геометрия уже в судовых
    координатах), компоненты — переносом в свои центры, дейдвуды — с
    поворотом по наклону линии вала."""
    print('Сборка...')
    doc = app.Documents.Add(DOC_ASSEMBLY, True)
    doc3d = module.IKompasDocument3D(doc)
    asm = doc3d.TopPart
    asm.Name = boat['name']

    # корпус: строился в судовых координатах — в нули
    insert_part(module, asm, files['hull'], placement_matrix(0, 0, 0))

    # перо руля: деталь построена от нуля (хорда по X, размах по Z);
    # ставим задней кромкой на rudder.x под днище, в ДП
    if files.get('rudder'):
        r = boat['rudder']
        z_top = min(p[1] for p in boat['stations'][0]['points'])  # низ транца
        insert_part(module, asm, files['rudder'],
                    placement_matrix(r['x'], 0.0, z_top - r['span']))

    # дейдвуды: поворот вокруг Y по наклону вала, перенос в кормовой конец
    for i, seg in enumerate(boat['shaftLine']):
        f = files['deadwood'][i]
        ang = math.degrees(math.atan2(seg['z2'] - seg['z1'],
                                      seg['x2'] - seg['x1']))
        insert_part(module, asm, f,
                    placement_matrix(seg['x1'], seg.get('y', 0.0), seg['z1'],
                                     rot_y_deg=-ang))

    # компоненты: центр болванки — в центр из boat.json
    for comp in boat['components']:
        f = files['components'].get(comp['id'])
        if f:
            insert_part(module, asm, f,
                        placement_matrix(comp['x'], comp['y'], comp['z']))

    path = os.path.join(out_dir, '%s_сборка.a3d' % safe_name(boat['name']))
    save_doc(doc3d, path)
    return path


# ===========================================================================
# 9. Служебное и точка входа
# ===========================================================================
def safe_name(name):
    """Имя файла без символов, запрещённых в Windows."""
    for ch in '\\/:*?"<>|':
        name = name.replace(ch, '_')
    return name.strip() or 'boat'


def main(argv):
    json_path = (argv[1] if len(argv) > 1
                 else os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   'boat.json'))
    if not os.path.isfile(json_path):
        print('Не найден файл %s\n'
              'Экспортируйте boat.json на странице конструктора и укажите '
              'путь: python boat_kompas.py путь\\к\\boat.json' % json_path)
        return 1

    boat = read_boat(json_path)
    out_dir = os.path.dirname(os.path.abspath(json_path))
    print('Модель «%s»: L=%.0f, B=%.0f, T=%.0f, D=%.0f, стенка %.1f мм'
          % (boat['name'], boat['L'], boat['B'], boat['T'], boat['D'],
             boat['wall']))

    module, app = get_kompas()
    files = {'components': {}, 'deadwood': []}
    failed = []

    # каждая деталь строится независимо: одна ошибка не валит остальное
    try:
        files['hull'] = build_hull(module, app, boat, out_dir)
    except Exception:
        failed.append('корпус')
        traceback.print_exc(limit=3)

    try:
        files['rudder'] = build_rudder(module, app, boat, out_dir)
    except Exception:
        failed.append('перо руля')
        traceback.print_exc(limit=3)

    for i, seg in enumerate(boat['shaftLine']):
        try:
            files['deadwood'].append(
                build_deadwood(module, app, boat, i, seg, out_dir))
        except Exception:
            failed.append('дейдвуд %d' % (i + 1))
            traceback.print_exc(limit=3)

    for comp in boat['components']:
        try:
            files['components'][comp['id']] = build_component(
                module, app, comp, out_dir)
        except Exception:
            failed.append('компонент %s' % comp['id'])
            traceback.print_exc(limit=3)

    if files.get('hull'):
        try:
            build_assembly(module, app, boat, files, out_dir)
        except Exception:
            failed.append('сборка')
            traceback.print_exc(limit=3)
    else:
        print('Сборка пропущена: не построился корпус.')

    if failed:
        print('\nГотово с ошибками, не построилось: %s' % ', '.join(failed))
        return 2
    print('\nГотово. Все модели лежат рядом с boat.json: %s' % out_dir)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

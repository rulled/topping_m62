# Индекс документации

> Обновлено 2026-11-19. Здесь карта всех документов: что читать и зачем.

---

## Начать здесь

| документ | о чём | для кого |
|---|---|---|
| **[../README.md](../README.md)** | обзор проекта, быстрый старт, тесты | все |
| **[WEB-CLIENT.md](WEB-CLIENT.md)** | главный документ: архитектура, правила протокола, что проверено | разработчик |
| **[../research/CONTROLS-MAP.md](../research/CONTROLS-MAP.md)** | полная карта контролов из драйвера ядра | разработчик |

---

## Протокол и устройство

| документ | о чём |
|---|---|
| [PROTOCOL.md](PROTOCOL.md) | формат кадра (15 байт), теги, CRC, handshake |
| [MIXER.md](MIXER.md) | микшер: 5 шин × 11 источников, почему не читается |
| [EQ-HP.md](EQ-HP.md) | EQ наушников: 10 полос × 2 канала |
| [EFFECTS.md](EFFECTS.md) | шумоподавление, компрессор, реверб |
| [../research/LINUX-DRIVER.md](../research/LINUX-DRIVER.md) | опубликованный драйвер ядра: что подтвердилось |
| [../research/UCM-ARCHITECTURE.md](../research/UCM-ARCHITECTURE.md) | архитектура: 10 каналов playback = 5 стерео-шин, 16 capture |

---

## Сервер и API

| документ | о чём |
|---|---|
| [API.md](API.md) | **61 маршрут** — полный справочник |
| [ARCHITECTURE.md](ARCHITECTURE.md) | как устроен сервер, слои |
| [BACKEND.md](BACKEND.md) | модули, три канала данных |

**Важно:** для веб-клиента сервер нужен только чтобы отдать файлы
страницы. Само управление идёт через WebHID прямо из браузера.

---

## Прошивка и железо

| документ | о чём |
|---|---|
| **[../research/CAPABILITIES.md](../research/CAPABILITIES.md)** | **итоговый отчёт: что можем, что недоступно** |
| **[../research/HARDWARE.md](../research/HARDWARE.md)** | **полный список чипов** (2× ES9821Q, AK7604, XU316, STM32G070) |
| **[../research/FIRMWARE-REVERSE.md](../research/FIRMWARE-REVERSE.md)** | **архитектура найдена**: xCore XS3, разбирается в Ghidra |
| [../research/BOARD-PHOTOS.md](../research/BOARD-PHOTOS.md) | плата: что где стоит, слепые зоны |
| [../research/FEASIBILITY.md](../research/FEASIBILITY.md) | что можно и чего нельзя: оценка усилий |
| [../research/PROGRAMMERS.md](../research/PROGRAMMERS.md) | CP2102/FT232RL: что подходит для флеша |
| [../research/FIRMWARE-CONCLUSION.md](../research/FIRMWARE-CONCLUSION.md) | ⚠ история: как мы ошибались с архитектурой |

---

## Внешние данные

| документ | о чём |
|---|---|
| [../research/ASR-THREAD.md](../research/ASR-THREAD.md) | обзор ASR (8 страниц): порты, каналы, режимы, латентность |
| [../research/ASR-THREAD-2.md](../research/ASR-THREAD-2.md) | вторая ветка: дескрипторы Linux, factory reset, баги прошивки |
| [../research/board-photos/](../research/board-photos/) | фото платы и кропы чипов |

---

## Для дизайнера

| документ | о чём |
|---|---|
| [FOR-DESIGNER.md](FOR-DESIGNER.md) | какие параметры существуют, диапазоны, единицы (без решений о виде) |

---

## История и архив

| что | где |
|---|---|
| журнал измерений (600 КБ) | [../research/NOTES.md](../research/NOTES.md) |
| одноразовые скрипты (492 шт.) | [../research/archive/tools/](../research/archive/tools/) |
| чужие материалы (REA), не про M62 | [../research/external/](../research/external/) |

---

## Что удалено и почему

В ревизии 2026-11-19 удалены документы, которые вводили в
заблуждение:

| удалён | почему |
|---|---|
| `STATUS.md` | состояние на 2026-11-08, устарело на 11 дней |
| `PLAN.md` | план, который уже выполнен |
| `TODO-HANDS.md` | список ручных задач, часть уже сделана |
| `goldfish_review_report.md` | отчёт ревью документа, которого больше нет |
| `goldfish_arch_review.md` | то же |

Их содержание, если нужно, есть в git-истории.

---

## Как читать NOTES.md

`research/NOTES.md` — журнал на 600 КБ, 170+ разделов. Это **не
документация, а история измерений**. Читать подряд бессмысленно.

Ищите по номеру раздела (§N) или по ключевому слову:

```bash
grep -n "§175" research/NOTES.md      # раздел про прорыв с прошивкой
grep -n "handshake" research/NOTES.md
```

Свежие разделы (2026-11-19): §164–§175.

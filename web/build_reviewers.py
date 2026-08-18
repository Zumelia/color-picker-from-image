#!/usr/bin/env python3
"""
Страница для тех, кто согласился посмотреть расширение: /reviewers/ —
служебная, noindex, ни с чего не слинкована. Скопировано с пилота
(json-beautifier/repo/web/build_reviewers.py), контент — под джобы пикера.
Отличие от пилота (решение Кирилла 2026-08-07): страница ОДНА, прямо на
/reviewers/ — без отдельной консоли пула и без /go/; сообщение для чатов
живёт в outreach/communities_pixelpeek.md.

Отзыв человек пишет сам и целиком: это его впечатление, и подставлять за него
слова нельзя. Страница даёт только повод — список вопросов, чтобы не сидеть
перед пустым полем в сторе.

Порядок вопросов случайный при каждом заходе. Иначе отвечают на первые три и
все отзывы получаются про одно и то же.

  /reviewers/   инструкция и пятнадцать вопросов

    python3 build_reviewers.py
"""

import json
from html import escape
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "reviewers"

STORE = "https://chromewebstore.google.com/detail/ndcooadfngbpjbaemeeajjdkjmpefbfm"

# (язык, тема, что попробовать, три вопроса). Вопросы открытые: на «понятно ли»
# и «всё ли верно» единственный естественный ответ — «да», и отзыв выходит
# пустым. Спрашиваем что, как и сколько.
TOPICS = [
    ("ru", "Свой файл", "открой скриншот, лого или фото, из которого реально нужен цвет",
     ["Что за картинку открыл и какой цвет из неё был нужен?",
      "Сколько шагов заняло от открытия файла до цвета в буфере?",
      "Как ты раньше доставал цвет из файла — и чем этот путь отличается?"]),
    ("ru", "Ctrl+V из буфера", "на любом сайте: ПКМ по картинке → Copy image, потом Ctrl+V в пикере",
     ["Откуда взял картинку и что произошло после Ctrl+V?",
      "Насколько чёткой она пришла — совпало с оригиналом?",
      "Где такой сценарий сэкономит тебе время в реальной работе?"]),
    ("ru", "Лупа и точность", "наведись на границу двух цветов и посмотри на сетку пикселей",
     ["Какое сложное место проверял — сглаженный край, градиент, тонкую линию?",
      "Что показала лупа там, где обычные пипетки мажут?",
      "Как быстро попал в нужный пиксель и что помогло?"]),
    ("ru", "Стрелки", "двигай прицел стрелками: 1 px за нажатие, с Ctrl — 10 px, Enter берёт цвет",
     ["В какой ситуации двигал прицел стрелками, а не мышью?",
      "Что дало движение по одному пикселю на твоей картинке?",
      "Каких клавиш или движений не хватило?"]),
    ("ru", "HEX, RGB, HSL", "кликни по строкам форматов на панели справа",
     ["Какой формат нужен в твоей работе и куда ты его вставлял?",
      "Как ты понял, что цвет действительно скопировался?",
      "Какого формата или варианта записи не хватило?"]),
    ("ru", "Автокопия", "возьми несколько цветов подряд с включённой автокопией HEX",
     ["Сколько цветов взял подряд и куда они шли дальше?",
      "Что изменила автокопия в этом процессе?",
      "«Пишет, что скопировано, а в буфере пусто» — частая жалоба на пикеры; что показал этот?"]),
    ("ru", "Палитра", "открой пёструю картинку и посмотри на Dominant colors",
     ["Что за картинка была и какие цвета встали в палитру?",
      "Сверил палитру с картинкой — эти цвета в ней реально есть?",
      "Для какой задачи такая палитра пригодится — или почему нет?"]),
    ("ru", "История", "набери несколько цветов, полностью закрой браузер, открой снова",
     ["Сколько цветов было в истории и что с ними стало после перезапуска?",
      "В какой момент старый цвет из истории реально пригодился?",
      "Чего в истории не хватает — экспорт, подписи, что-то ещё?"]),
    ("ru", "ПКМ по картинке", "на любом сайте: правый клик по картинке → Pick color from this image",
     ["На каком сайте пробовал и что открылось?",
      "Попалась ли картинка, которую сайт отдавать не хотел, — и что сделало расширение?",
      "Насколько это быстрее твоего прежнего способа?"]),
    ("ru", "Grab this page", "в попапе расширения нажми Grab this page на обычном сайте",
     ["Какую страницу захватывал и что за цвет на ней был нужен?",
      "Совпал ли снимок с тем, что было на экране?",
      "Какие границы этой функции ты заметил?"]),
    ("ru", "Права доступа", "вспомни установку и загляни в chrome://extensions → Details",
     ["Какие предупреждения Chrome показал при установке?",
      "«Подозрительные права» — главная претензия к пикерам в отзывах; как на их фоне выглядит этот?",
      "Что бы ты проверил, прежде чем доверять такому расширению?"]),
    ("ru", "Тёмная тема", "переключи тему кнопкой в шапке пикера",
     ["Что в тёмной теме выглядит продуманным, а что просто перекрашенным?",
      "Как в темноте читаются лупа, шахматка прозрачности и панель значений?",
      "На чём глаз спотыкается?"]),
    ("ru", "Прозрачность", "открой PNG с прозрачным фоном и кликни по прозрачному месту",
     ["Что показал пикер на прозрачном пикселе?",
      "Как выглядит шахматка под полупрозрачными краями?",
      "Что в этом месте делают другие пикеры, которыми ты пользовался?"]),
    ("ru", "Первое впечатление", "вспомни момент установки и первый взятый цвет",
     ["Опиши первые минуты: что произошло сразу после установки?",
      "Сколько времени прошло до первого цвета в буфере?",
      "Что было непонятно или показалось лишним?"]),
    ("ru", "Чего не хватает", "погоняй расширение пару дней на своих задачах",
     ["На каких задачах гонял и как часто открывал?",
      "В какой момент захотелось функции, которой нет, — какой именно?",
      "Что раздражает при ежедневном использовании?"]),
    ("en", "Your own file", "drop a screenshot or logo you actually needed a color from",
     ["What image did you open, and which color did you need out of it?",
      "How many steps from opening the file to the hex in your clipboard?",
      "How were you getting colors out of files before — what changed?"]),
    ("en", "Paste from clipboard", "on any site: right-click an image → Copy image, then Ctrl+V in the picker",
     ["Where did the image come from, and what happened after Ctrl+V?",
      "How sharp did it arrive — did it match the original?",
      "Where would this move save you time in real work?"]),
    ("en", "Pixel precision", "hover a border between two colors and watch the loupe grid",
     ["What tricky spot did you test — an antialiased edge, a gradient, a thin line?",
      "What did the pixel grid show where eyedroppers usually miss?",
      "Arrow keys move 1 px at a time — when did that matter?"]),
    ("en", "The palette", "open something colorful and check Dominant colors",
     ["What image was it, and which colors made the palette?",
      "Did you check them against the image — are they actually in there?",
      "What would you use the palette for, if anything?"]),
    ("en", "History across restarts", "pick a few colors, quit the browser fully, come back",
     ["How many colors survived the restart, and did you expect them to?",
      "When did an old color from the history actually save you?",
      "What's missing there — export, labels, something else?"]),
    ("en", "Permissions", "recall the install prompt and open chrome://extensions → Details",
     ["What warnings did Chrome show when you installed it?",
      "\"Shady permissions\" is the top complaint about color pickers — how does this one compare?",
      "What would you verify before trusting a tool like this?"]),
    ("en", "No network", "open DevTools → Network while you use the picker",
     ["What did you check, and what showed up in the Network tab?",
      "Why does that matter for a tool you feed your screenshots to?",
      "What else would you want verified before trusting it?"]),
    ("en", "Grab this page", "press it in the extension popup on a normal website",
     ["What page did you grab, and what did you need from it?",
      "How did the snapshot compare with what was on your screen?",
      "What limits of this feature did you run into?"]),
    ("en", "Coming from another picker", "compare it against whatever you used before",
     ["What were you using before, and for what kind of work?",
      "Describe a moment where the difference between them showed",
      "What does the old one still do better?"]),
    ("en", "Honest downside", "use it for a couple of days on real work",
     ["What did you use it for over those days?",
      "Describe the moment it annoyed you most",
      "What would stop you recommending it to a colleague?"]),
]

UI = {
    "ru": {
        "title": "Вопросы для вдохновения",
        "sub": "Отвечать на все не надо — выбери то, что зацепило, и напиши своими словами.",
        "swap": "In English",
        "intro": "Спасибо, что смотришь. Поставь, погоняй на своих картинках — а ниже "
                 "вопросы на случай, если не знаешь, с чего начать отзыв.",
        "nope": "Если расширение не понравилось — не пиши отзыв, напиши напрямую: ",
        "nope_link": "форма обратной связи",
        "steps_title": "Как оставить отзыв",
        "steps": [
            'Поставь расширение: <a href="{store}" target="_blank" rel="noopener">Chrome Web Store</a>',
            'Открой пикер (иконка на панели → <b>Open picker</b>) и брось туда любой скриншот или лого — или просто нажми <b>Ctrl+V</b>',
            "Ниже есть список вопросов для вдохновения для отзыва",
            'Вернись на страницу расширения в сторе: вкладка <b>Reviews</b> → <b>Write a review</b>, напиши своими словами и отправь',
        ],
    },
    "en": {
        "title": "Questions for inspiration",
        "sub": "No need to answer them all — pick whatever struck you and write it your way.",
        "swap": "По-русски",
        "intro": "Thanks for taking a look. Install it, use it on your own images — the "
                 "questions below are there in case you don't know where to start.",
        "nope": "If you didn't like it, please don't review it — tell me instead: ",
        "nope_link": "feedback form",
        "steps_title": "How to leave a review",
        "steps": [
            'Install it: <a href="{store}" target="_blank" rel="noopener">Chrome Web Store</a>',
            'Open the picker (toolbar icon → <b>Open picker</b>) and drop in any screenshot or logo — or just press <b>Ctrl+V</b>',
            "Below is a list of questions to give you something to write about",
            'Back on the store page: <b>Reviews</b> → <b>Write a review</b>, write it in your own words and send',
        ],
    },
}

# .lead/.card/.note-strip/.eyebrow в site.css пикера нет (в отличие от пилота) —
# определяются здесь на наших токенах.
CSS = """
  .lead { font-size: 18px; line-height: 1.65; color: var(--muted); margin: 10px 0 0; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
          padding: 20px 22px; }
  .note-strip { background: var(--chip); border: 1px solid var(--line);
                border-radius: 10px; padding: 12px 16px; color: var(--muted); }
  .eyebrow { font-family: var(--mono); font-size: 12px; letter-spacing: .06em;
             text-transform: uppercase; color: var(--faint); }
  h1 { font-family: var(--disp); font-size: clamp(28px, 4vw, 38px);
       letter-spacing: -.02em; margin: 0;
       display: flex; align-items: center; gap: 16px; }
  h1 .mark { width: 46px; height: 46px; border-radius: 13px; }
  h1 .mark i { width: 23px; height: 23px; border-width: 3.5px; }
  h1 .mark i b { width: 8px; height: 8px; }
  .pick { display: flex; gap: 10px; margin: 16px 0 0; flex-wrap: wrap; }

  .steps-box { margin-top: 30px; }
  .steps-box h2 { font-family: var(--disp); font-size: clamp(22px, 2.6vw, 26px); margin: 0; }
  .steps { margin: 20px 0 0; padding-left: 22px; }
  .steps li { margin-bottom: 9px; }

  .qs-title { font-family: var(--disp); margin: 38px 0 8px; font-size: clamp(24px, 3vw, 30px); }
  .qs-sub { margin: 0 0 18px; color: var(--muted); }
  .qs { margin: 0; padding: 0; list-style: none; }
  .qs li { padding: 15px 0; border-bottom: 1px solid var(--line2); }
  .qs li:last-child { border-bottom: 0; }
  .qs-q { font-size: 16.5px; }
  .qs-topic { display: block; margin-top: 5px; font-family: var(--mono);
              font-size: 12px; letter-spacing: .04em; color: var(--faint); }
"""

JS = """
(() => {
  "use strict";
  const POOL = __POOL__;
  const UI = __UI__;
  const HOW_MANY = 15;

  const lang = (() => {
    const saved = localStorage.getItem("cpfi-rev-lang");
    if (saved === "ru" || saved === "en") return saved;
    return (navigator.language || "en").toLowerCase().startsWith("ru") ? "ru" : "en";
  })();
  const t = UI[lang];

  document.documentElement.lang = lang;
  document.querySelector("[data-intro]").textContent = t.intro;
  document.querySelector("[data-strip]").innerHTML =
    t.nope + '<a href="/feedback/">' + t.nope_link + "</a>.";
  document.querySelector("[data-qs-title]").textContent = t.title;
  document.querySelector("[data-qs-sub]").textContent = t.sub;
  const swap = document.querySelector("[data-lang-switch]");
  swap.textContent = t.swap;
  swap.addEventListener("click", () => {
    localStorage.setItem("cpfi-rev-lang", lang === "ru" ? "en" : "ru");
    location.reload();
  });
  const steps = document.querySelector('[data-steps="' + lang + '"]');
  if (steps) steps.hidden = false;

  // Порядок случайный при каждом заходе и НЕ запоминается: иначе человек
  // отвечает на первые три, и все отзывы выходят про одно и то же.
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // Сначала по одному вопросу из каждой темы, и только потом добираем: пятнадцать
  // вопросов из пяти тем — это те же пять вопросов, сказанные по-разному.
  const mine = POOL.filter((q) => q.lang === lang);
  const byTopic = new Map();
  mine.forEach((q) => {
    if (!byTopic.has(q.topic)) byTopic.set(q.topic, []);
    byTopic.get(q.topic).push(q);
  });
  const buckets = shuffle([...byTopic.values()].map((qs) => shuffle(qs.slice())));
  const chosen = [];
  for (let round = 0; chosen.length < HOW_MANY && round < 3; round++) {
    for (const b of buckets) {
      if (chosen.length >= HOW_MANY) break;
      if (b[round]) chosen.push(b[round]);
    }
  }

  const list = document.querySelector("[data-qs]");
  shuffle(chosen).forEach((q) => {
    const li = document.createElement("li");
    const main = document.createElement("span");
    main.className = "qs-q";
    main.textContent = q.q;
    const sub = document.createElement("span");
    sub.className = "qs-topic";
    sub.textContent = q.topic + " · " + q.try;
    li.append(main, sub);
    list.appendChild(li);
  });
})();
"""

GO_TEMPLATE = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Color Picker from Image</title>
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="/assets/favicon.png?v=1" type="image/png">
<link rel="stylesheet" href="/assets/fonts.css?v=1">
<link rel="stylesheet" href="/assets/site.css?v=1">
<script>try{var t=localStorage.getItem('cpfi-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}</script>
<style>__CSS__</style>
</head>
<body>
<main id="main">
  <section class="wrap section" style="max-width:820px">
    <h1><a href="/" aria-label="colorpickfromimage.com"><span class="mark"><i><b></b></i></span></a>Color Picker from Image</h1>
    <div class="pick"><button class="btn btn-sm btn-ghost" data-lang-switch></button></div>
    <p class="lead" data-intro></p>

    <div class="steps-box" data-steps="ru" hidden>__STEPS_RU__</div>
    <div class="steps-box" data-steps="en" hidden>__STEPS_EN__</div>

    <p class="note-strip" style="margin-top:26px" data-strip></p>

    <h2 class="qs-title" data-qs-title></h2>
    <p class="qs-sub" data-qs-sub></p>
    <div class="card"><ul class="qs" data-qs></ul></div>
  </section>
</main>
<script>__JS__</script>
</body>
</html>
"""

def steps_html(lang):
    u = UI[lang]
    items = "".join("<li>" + s.format(store=STORE) + "</li>" for s in u["steps"])
    return f'<h2>{escape(u["steps_title"])}</h2><ol class="steps">{items}</ol>'


def build_go(pool):
    html = (GO_TEMPLATE
            .replace("__CSS__", CSS)
            .replace("__STEPS_RU__", steps_html("ru"))
            .replace("__STEPS_EN__", steps_html("en"))
            .replace("__JS__", JS
                     .replace("__POOL__", json.dumps(pool, ensure_ascii=False))
                     .replace("__UI__", json.dumps(UI, ensure_ascii=False))))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(html, encoding="utf-8")
    return len(html)


def main():
    pool = [{"lang": lang, "topic": topic, "try": tryit, "q": q}
            for lang, topic, tryit, qs in TOPICS for q in qs]
    size = build_go(pool)
    ru = sum(1 for p in pool if p["lang"] == "ru")
    print(f"  reviewers/index.html  {len(pool)} вопросов ({ru} ru / {len(pool) - ru} en) "
          f"из {len(TOPICS)} тем, {size:,} B")


if __name__ == "__main__":
    main()

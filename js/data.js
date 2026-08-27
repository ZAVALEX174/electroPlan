/* Product catalog from the VIMAR price list.
   Replace DataService.mode with "api" and set apiBase when backend is ready. */
window.EP_DATA = {
  settings: {
    dataMode: "mock",
    apiBase: "/api",
    currency: window.EP_VIMAR_CATALOG?.meta?.currency || "EUR",
    workPercent: 18,
    materialsPercent: 7,
    discountPercent: 0,   // скидка на оборудование, задаётся в интерфейсе
    vatPercent: 20,       // ставка НДС
    vatEnabled: true,     // включать ли НДС в коммерческое предложение
    // Надбавка к курсу ЦБ, % (правило ЦентрСвет: цена = курс ЦБ + 3%).
    // Новые проекты стартуют с 3; старые проекты без этого поля открываются
    // с 0 (см. restoreProject), иначе ранее сохранённые сметы задним числом
    // подорожали бы на надбавку. К ручному курсу надбавка не применяется.
    rateSurchargePercent: 3,
    // Тип стены проекта: solid — кирпич/бетон/сплошные (в РФ чаще, потому по умолчанию),
    // hollow — ГКЛ/полые. Свойство ПРОЕКТА (не отдельного поста): в одном объекте стены
    // обычно одного типа. Влияет на подбор монтажной коробки в конструкторе поста.
    wallType: "solid",
    // Прайс VIMAR в евро — это базовая валюта всех цен в каталоге.
    // displayCurrency лишь меняет представление, сами цены не переписываются.
    displayCurrency: "EUR",
    eurRate: null,        // рублей за 1 евро (курс ЦБ РФ либо введён вручную)
    rateDate: null,
    rateSource: null
  },
  catalogMeta: window.EP_VIMAR_CATALOG?.meta || null,
  categories: [
    {id:1,name:"Механизмы"},
    {id:2,name:"Рамки"},
    {id:3,name:"Монтажные элементы"}
  ],
  /* Признаки автосостава поста (стандарт накладки, тип стены коробки) лежат отдельным
     JS-глобалом EP_VIMAR_ATTRS (js/catalog-vimar-attrs.js), а не в catalog-vimar.js:
     тот пересобирается конвертером и правки в нём теряются, а fetch() JSON с диска не
     работает при открытии index.html через file:// (PLAN 2.2). Подмешиваем их к товарам
     здесь, один раз при загрузке; если файла нет — товары просто без этих полей
     (стандарт → unknown, тип стены → не подтверждён), приложение это переживает. */
  products: (function enrichCatalog(){
    const list = window.EP_VIMAR_CATALOG?.products || [];
    const attrs = window.EP_VIMAR_ATTRS || {standards:{},supports:{},wallTypes:{},boxes:{},mounting:{},roles:{}};
    const supports = attrs.supports || {};
    const boxes = attrs.boxes || {};
    /* Роль детали в посте и роль управления — из колонок номенклатуры «Функциональная группа»
       и «Тип управления», а не из эвристики по названию. До этого раздела отличить клавишу от
       голого механизма в рантайме можно было только косвенно: по categoryId=900 (его ставит
       classify() за слово «клавиш» — заодно со словами «накладк», «крышк», «винт») и по
       отсутствию moduleSpan. Оба — побочный эффект, и любая новая строка «Крышка…» стала бы
       «клавишей». Ключ раздела — артикул, запись {part, control}. */
    const roles = attrs.roles || {};
    // Монтажное правило видов, у которых своего раздела признаков нет (механизмы, аксессуары):
    // «Принцип обработки» номенклатуры заполнен и им (BUTTON/SCHUP/Bluetooth). У накладок,
    // суппортов и коробок правило приезжает вместе с их атрибутами — см. ветки ниже.
    const mounting = attrs.mounting || {};
    // Перенос монтажного правила на товар — одинаковый для любого вида, поэтому одной
    // функцией. Поле появляется, ТОЛЬКО если номенклатура его заполнила: рантайм отличает
    // «правила нет» (подбор по ёмкости, как раньше) от «правило есть» по наличию ключа.
    const applyRule = (out, a) => {
      if (a && a.principle) out.principle = a.principle;
      if (a && a.boxModularity != null) out.boxModularity = a.boxModularity;
      return out;
    };
    // Измеренные монтажные окна накладок (js/catalog-vimar-openings.js) — снятые детектором с
    // ДЕТАЛЬНОГО фото прямоугольники в % фото. Ключ — БАЗА артикула (09673.01/09673.04 → 09673):
    // геометрия окон у цветовых вариантов одна и та же. Итальянская несёт одно окно → mountRect,
    // немецкая несколько → mountRects; EPCatalog.frameOpening/frameOpenings читают эти поля.
    const openings = window.EP_VIMAR_OPENINGS || {};
    const attachOpenings = (p, out) => {
      const o = openings[String(p.code || "").split(".")[0]];
      if (!o || !Array.isArray(o.rects) || !o.rects.length) return out;
      const res = out === p ? {...p} : out;
      const rects = o.rects.map(r => ({left: r[0], top: r[1], width: r[2], height: r[3], aspect: o.aspect}));
      if (rects.length === 1) res.mountRect = rects[0]; else res.mountRects = rects;
      return res;
    };
    // Лицевой прямоугольник механизма (js/catalog-vimar-faces.js) — снятый детектором с ДЕТАЛЬНОГО
    // фото прямоугольник [left,top,width,height] в % фото. В собранном посте им обрезается фото
    // механизма под ячейку модуля (postImage). Ключ — ПОЛНЫЙ артикул (у механизмов база ненадёжна:
    // суффикс после точки кодирует и цвет, и число модулей — 09001.0.250 это 1М, 09001.2.CM это 2М).
    // EPCatalog.moduleFace читает это поле; нет файла/записи → механизм рисуется клавишей-фолбэком.
    const faces = window.EP_VIMAR_FACES || {};
    return list.map(p => {
      if (p.kind === "frame") {
        let out = p;
        if (attrs.standards[p.code]) {
          const a = attrs.standards[p.code];
          // layoutRows — раскладка накладки на посты (немецкая «(2+2)», двухрядная «4+4»);
          // EPPosts.frameLayout читает её для превью/распределения. Нет её (обычная итальянская
          // однорядная) — рантайм выведет один пост на всю ширину.
          out = {...p, standard: a.standard, postCount: a.postCount};
          if (a.layoutRows) out.layoutRows = a.layoutRows;
          // Монтажное правило накладки («Принцип обработки» + «Модульность для коробки»):
          // principle — код схемы монтажа (1M_CENTRAL/2M_CENTRAL/NO_SUPPORT/…), boxModularity —
          // модульность КОРОБКИ, которая у «центральных» накладок больше их собственной ёмкости
          // (1М-накладка садится в коробку на 2 модуля, 2М — на 3). EPPostFit подбирает по ним
          // коробку и суппорт; нет правила в номенклатуре — полей нет, подбор идёт как раньше.
          applyRule(out, a);
        }
        return attachOpenings(p, out);
      }
      // Суппорт: стандарт + число модулей + межосевой шаг — для findSupport (подбор
      // планки той же серии, модульности и стандарта, что накладка). principle/boxModularity —
      // то же монтажное правило, что у накладки: по совпадению пары (принцип + модульность
      // коробки) выделенный «центральный» суппорт находит свою накладку (09672→09606,
      // 14652→14612) — без них он неотличим от обычного суппорта той же модульности.
      if (p.kind === "support" && supports[p.code]) {
        const a = supports[p.code];
        return applyRule({...p, standard: a.standard, moduleCount: a.modules, pitchMm: a.pitchMm}, a);
      }
      // Коробка: тип стены + форма + число модулей + совместимые стандарты — для findBox.
      // boxStandards отделено от standard накладки: у коробки это СПИСОК (круглая годна
      // под IT_ROUND/DE/FR, прямоугольная — под IT), фолбэк по нему не противоречит стандарту.
      // principle коробки — её монтажное правило («NO_INNERS, AQUAPLATE» у IP55-корпусов
      // 14901–14904): признак влагозащищённой линейки, по нему документы отличают корпус
      // накладного монтажа от врезной коробки.
      if (p.kind === "socket_box") {
        const b = boxes[p.code];
        if (b) return applyRule({...p, wallType: b.wallType, boxShape: b.shape, boxModules: b.modules, boxStandards: b.standards}, b);
        if (attrs.wallTypes[p.code]) return {...p, wallType: attrs.wallTypes[p.code]};
      }
      // Механизм: лицевой прямоугольник фото (faceRect) — по ПОЛНОМУ артикулу, для обрезки фото
      // под ячейку модуля в собранном посте. Нет записи → останется без faceRect (клавиша-фолбэк).
      let out = p;
      if (p.kind === "mechanism") {
        const f = faces[p.code];
        if (f && Array.isArray(f.face) && f.face.length === 4) {
          out = {...p, faceRect: {left: f.face[0], top: f.face[1], width: f.face[2], height: f.face[3]}};
        }
      }
      // Монтажное правило для видов без своего раздела признаков (механизмы, аксессуары):
      // у механизма это принцип обработки (BUTTON — клавишный, SCHUP — с заземляющими
      // контактами, Bluetooth и т. д.). Раньше сборка клала правило только накладкам и
      // суппортам, и до рантайма не доходил ни один из 158 механизмов с заполненным полем.
      const m = mounting[p.code];
      if (m) out = applyRule(out === p ? {...p} : out, m);
      /* Роль детали: partRole — "bare_mechanism" (изделие без клавиши, её надо подобрать
         отдельно) либо "key" (клавиша, садится на голый механизм); controlRole — "switch" /
         "changeover" / "button" / "inverter" / "sensor" / "bluetooth", те же строки, что ROLES
         в js/lightingGroups.js, чтобы подбор механизма по роли места сравнивал их напрямую.
         Полей нет, если номенклатура признака не даёт, — «нет роли» отличается от «роль пустая»
         по отсутствию ключа, как у principle/boxModularity. Раздел сквозной (роли есть только
         у механизмов и клавиш — у накладок, суппортов и коробок «Тип управления» не заполнен
         ни у одной позиции, проверено на сборке), поэтому лежит здесь, рядом с mounting. */
      const r = roles[p.code];
      if (r) {
        out = out === p ? {...p} : out;
        if (r.part) out.partRole = r.part;
        if (r.control) out.controlRole = r.control;
      }
      return out;
    });
  })()
};

window.DataService = {
  mode: window.EP_DATA.settings.dataMode,
  async getProducts(){
    if(this.mode === "api"){
      const response = await fetch(window.EP_DATA.settings.apiBase + "/products");
      if(!response.ok) throw new Error("Ошибка загрузки каталога");
      return response.json();
    }
    return structuredClone(window.EP_DATA.products);
  },
  async getSavedPosts(){
    if(this.mode === "api"){
      const response = await fetch(window.EP_DATA.settings.apiBase + "/posts");
      if(!response.ok) throw new Error("Ошибка загрузки постов");
      return response.json();
    }
    return JSON.parse(localStorage.getItem("ep_post_templates") || "[]");
  },
  async savePost(post){
    if(this.mode === "api"){
      const response = await fetch(window.EP_DATA.settings.apiBase + "/posts",{
        method: post.id ? "PUT" : "POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(post)
      });
      if(!response.ok) throw new Error("Ошибка сохранения поста");
      return response.json();
    }
    const list = JSON.parse(localStorage.getItem("ep_post_templates") || "[]");
    const index = list.findIndex(x=>x.id===post.id);
    if(index>=0) list[index]=post; else list.push(post);
    localStorage.setItem("ep_post_templates",JSON.stringify(list));
    return post;
  },
  async deletePost(id){
    if(this.mode === "api"){
      await fetch(window.EP_DATA.settings.apiBase + "/posts/"+id,{method:"DELETE"});
      return;
    }
    const list=JSON.parse(localStorage.getItem("ep_post_templates")||"[]").filter(x=>x.id!==id);
    localStorage.setItem("ep_post_templates",JSON.stringify(list));
  }
};

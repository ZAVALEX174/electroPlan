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
    const attrs = window.EP_VIMAR_ATTRS || {standards:{},supports:{},wallTypes:{},boxes:{}};
    const supports = attrs.supports || {};
    const boxes = attrs.boxes || {};
    return list.map(p => {
      if (p.kind === "frame" && attrs.standards[p.code]) {
        const a = attrs.standards[p.code];
        return {...p, standard: a.standard, postCount: a.postCount};
      }
      // Суппорт: стандарт + число модулей + межосевой шаг — для findSupport (подбор
      // планки той же серии, модульности и стандарта, что накладка).
      if (p.kind === "support" && supports[p.code]) {
        const a = supports[p.code];
        return {...p, standard: a.standard, moduleCount: a.modules, pitchMm: a.pitchMm};
      }
      // Коробка: тип стены + форма + число модулей + совместимые стандарты — для findBox.
      // boxStandards отделено от standard накладки: у коробки это СПИСОК (круглая годна
      // под IT_ROUND/DE/FR, прямоугольная — под IT), фолбэк по нему не противоречит стандарту.
      if (p.kind === "socket_box") {
        const b = boxes[p.code];
        if (b) return {...p, wallType: b.wallType, boxShape: b.shape, boxModules: b.modules, boxStandards: b.standards};
        if (attrs.wallTypes[p.code]) return {...p, wallType: attrs.wallTypes[p.code]};
      }
      return p;
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

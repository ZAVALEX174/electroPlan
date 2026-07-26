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
    vatEnabled: true      // включать ли НДС в коммерческое предложение
  },
  catalogMeta: window.EP_VIMAR_CATALOG?.meta || null,
  categories: [
    {id:1,name:"Механизмы"},
    {id:2,name:"Рамки"},
    {id:3,name:"Монтажные элементы"}
  ],
  products: window.EP_VIMAR_CATALOG?.products || []
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

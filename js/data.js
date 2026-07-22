/* Mock database catalog.
   Replace DataService.mode with "api" and set apiBase when backend is ready. */
window.EP_DATA = {
  settings: {
    dataMode: "mock",
    apiBase: "/api",
    currency: "RUB",
    workPercent: 18,
    materialsPercent: 7
  },
  categories: [
    {id:1,name:"Механизмы"},
    {id:2,name:"Рамки"},
    {id:3,name:"Монтажные элементы"}
  ],
  products: [
    {id:101,code:"SOCKET-01",name:"Розетка 220 В",kind:"mechanism",icon:"◉",price:850,unit:"шт.",active:true},
    {id:102,code:"SWITCH-01",name:"Выключатель 1-клавишный",kind:"mechanism",icon:"⌁",price:620,unit:"шт.",active:true},
    {id:103,code:"DIMMER-01",name:"Диммер поворотный",kind:"mechanism",icon:"◒",price:1450,unit:"шт.",active:true},
    {id:104,code:"USB-01",name:"Розетка USB",kind:"mechanism",icon:"USB",price:1650,unit:"шт.",active:true},
    {id:105,code:"TV-01",name:"Розетка TV",kind:"mechanism",icon:"TV",price:1100,unit:"шт.",active:true},
    {id:106,code:"DATA-01",name:"Розетка RJ-45",kind:"mechanism",icon:"LAN",price:1350,unit:"шт.",active:true},
    {id:107,code:"LIGHT-01",name:"Светильник",kind:"standalone",icon:"☀",price:2400,unit:"шт.",active:true},
    {id:108,code:"BLANK-01",name:"Заглушка",kind:"mechanism",icon:"—",price:350,unit:"шт.",active:true},
    {id:201,code:"FRAME-WHITE",name:"Рамка белая",kind:"frame",icon:"□",price:450,unit:"шт.",active:true},
    {id:202,code:"FRAME-BLUE",name:"Рамка голубая",kind:"frame",icon:"□",price:520,unit:"шт.",active:true},
    {id:203,code:"FRAME-GRAPHITE",name:"Рамка графит",kind:"frame",icon:"□",price:590,unit:"шт.",active:true},
    {id:301,code:"BOX-01",name:"Подрозетник",kind:"socket_box",icon:"○",price:180,unit:"шт.",active:true}
  ]
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
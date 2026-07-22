window.ProjectStore = {
  key:"electroplan_current_project",
  save(project){
    localStorage.setItem(this.key,JSON.stringify(project));
  },
  load(){
    try{return JSON.parse(localStorage.getItem(this.key)||"null")}catch{return null}
  },
  clear(){localStorage.removeItem(this.key)}
};
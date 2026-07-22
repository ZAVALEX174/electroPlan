/**
 * Bitrix-адаптер источника данных для ElectroPlan.
 *
 * Заменяет js/data.js (DataService) из прототипа: интерфейс методов сохранён,
 * поэтому js/app.js не требует изменений. Данные идут через AJAX-контроллеры
 * модуля centrsvet.electroplan (local/modules/.../lib/Controller/*).
 *
 * Требует подключённого ядра Bitrix (BX.ajax.runAction).
 */
(function () {
    "use strict";

    var cfg = window.EP_BITRIX || {};
    var prefix = cfg.actionPrefix || "centrsvet:electroplan";

    function run(action, data, method) {
        return BX.ajax
            .runAction(prefix + "." + action, {
                data: data || {},
                method: method || "GET"
            })
            .then(function (response) {
                return response.data;
            });
    }

    window.DataService = {
        mode: "bitrix",

        async getProducts() {
            // Каталог уже отдан компонентом при первом рендере — используем его.
            if (Array.isArray(cfg.catalog) && cfg.catalog.length) {
                return cfg.catalog;
            }
            return run("Catalog.list");
        },

        async getSavedPosts() {
            return run("Post.list");
        },

        async savePost(post) {
            return run("Post.save", { post: post }, "POST");
        },

        async deletePost(id) {
            return run("Post.delete", { id: id }, "POST");
        }
    };
})();

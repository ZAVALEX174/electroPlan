<?php

namespace Centrsvet\Electroplan\Controller;

use Bitrix\Main\Engine\Controller;
use Centrsvet\Electroplan\Post\PostTemplateRepository;

/**
 * Шаблоны электрических постов.
 *
 * Заменяет DataService.getSavedPosts()/savePost()/deletePost() из прототипа.
 * Соответствует эндпоинтам /api/posts из api/README.md.
 * В прототипе данные лежали в LocalStorage — теперь в хранилище Битрикс (PLAN 6.3).
 */
class Post extends Controller
{
    /** GET /api/posts */
    public function listAction(): array
    {
        return (new PostTemplateRepository())->getAll();
    }

    /**
     * POST/PUT /api/posts
     * @param array $post { id?, name, frameId, socketBoxProductId, mechanismIds: int[] }
     */
    public function saveAction(array $post): array
    {
        return (new PostTemplateRepository())->save($post);
    }

    /** DELETE /api/posts/{id} */
    public function deleteAction(string $id): void
    {
        (new PostTemplateRepository())->delete($id);
    }
}

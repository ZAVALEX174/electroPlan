<?php

namespace Centrsvet\Electroplan\Post;

/**
 * Шаблоны электрических постов.
 *
 * Прототип хранил их в LocalStorage (ключ ep_post_templates).
 * Целевое хранилище — Highload-блок Битрикс EpPostTemplates (PLAN 6.3).
 *
 * Формат записи:
 *   { id, name, frameId, socketBoxProductId, mechanismIds: int[] }
 */
class PostTemplateRepository
{
    /** @return array<int, array> */
    public function getAll(): array
    {
        // TODO (PLAN 6.3): чтение из Highload-блока EpPostTemplates
        return [];
    }

    public function save(array $post): array
    {
        // TODO (PLAN 6.3): upsert в Highload-блок; при отсутствии id — сгенерировать
        return $post;
    }

    public function delete(string $id): void
    {
        // TODO (PLAN 6.3): удаление записи по id
    }
}

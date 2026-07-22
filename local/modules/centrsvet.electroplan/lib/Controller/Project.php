<?php

namespace Centrsvet\Electroplan\Controller;

use Bitrix\Main\Engine\Controller;
use Centrsvet\Electroplan\Project\ProjectRepository;

/**
 * Проекты электроснабжения (план + объекты + смета).
 *
 * Заменяет ProjectStore (LocalStorage) из прототипа (js/store.js).
 * Соответствует эндпоинтам /api/projects из api/README.md.
 */
class Project extends Controller
{
    /** GET /api/projects/{id} */
    public function getAction(string $id): ?array
    {
        return (new ProjectRepository())->get($id);
    }

    /**
     * POST/PUT /api/projects
     * @param array $project снимок проекта (devices, posts, rooms, walls, autoWalls, ...)
     */
    public function saveAction(array $project): array
    {
        return (new ProjectRepository())->save($project);
    }

    /**
     * POST /api/projects/{id}/commercial-offer
     * TODO (PLAN 6.7): серверная генерация PDF КП и сохранение в карточке проекта.
     */
    public function commercialOfferAction(string $id): array
    {
        return ['id' => $id, 'status' => 'not_implemented'];
    }
}

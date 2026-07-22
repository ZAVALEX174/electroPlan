<?php

namespace Centrsvet\Electroplan\Project;

/**
 * Проекты электроснабжения.
 *
 * Прототип хранил текущий проект в LocalStorage (js/store.js, projectSnapshot()).
 * Целевое хранилище — Highload-блок/инфоблок Битрикс EpProjects с привязкой
 * к пользователю (PLAN 6.4). Изображение плана — в файловом хранилище Битрикс (PLAN 6.5).
 *
 * Снимок проекта: { name, savedAt, devices[], posts[], rooms[], walls[], autoWalls[] }
 */
class ProjectRepository
{
    public function get(string $id): ?array
    {
        // TODO (PLAN 6.4): чтение проекта по id с проверкой прав пользователя
        return null;
    }

    public function save(array $project): array
    {
        // TODO (PLAN 6.4): upsert проекта, привязка к текущему пользователю Битрикс
        // TODO (PLAN 6.5): вынести data-URL плана в файловое хранилище, хранить FILE_ID
        return $project;
    }
}

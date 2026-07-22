-- PostgreSQL schema for ElectroPlan
CREATE TABLE categories (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 500,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  category_id BIGINT REFERENCES categories(id),
  code VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  kind VARCHAR(30) NOT NULL CHECK (kind IN ('mechanism','frame','socket_box','standalone')),
  icon VARCHAR(30),
  price NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit VARCHAR(30) NOT NULL DEFAULT 'шт.',
  image_url TEXT,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE post_templates (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  frame_product_id BIGINT NOT NULL REFERENCES products(id),
  socket_box_product_id BIGINT NOT NULL REFERENCES products(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE post_template_items (
  id BIGSERIAL PRIMARY KEY,
  post_template_id UUID NOT NULL REFERENCES post_templates(id) ON DELETE CASCADE,
  position_no INTEGER NOT NULL,
  mechanism_product_id BIGINT NOT NULL REFERENCES products(id),
  UNIQUE(post_template_id, position_no)
);

CREATE TABLE projects (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  customer_name VARCHAR(255),
  plan_image_url TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE project_objects (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  object_type VARCHAR(30) NOT NULL CHECK (object_type IN ('product','post','room','wall')),
  source_id VARCHAR(100),
  x NUMERIC(12,3),
  y NUMERIC(12,3),
  rotation NUMERIC(8,3) DEFAULT 0,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE price_history (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  price NUMERIC(14,2) NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
begin;

create table core.brands (
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint brands_external_key_not_blank check (btrim(external_key) <> ''),
  constraint brands_name_not_blank check (btrim(name) <> '')
);

create trigger core_brands_set_updated_at
before update on core.brands
for each row execute function app.set_updated_at();

create table core.categories (
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint categories_external_key_not_blank check (btrim(external_key) <> ''),
  constraint categories_name_not_blank check (btrim(name) <> '')
);

create trigger core_categories_set_updated_at
before update on core.categories
for each row execute function app.set_updated_at();

create table core.products (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references core.cabinets(id) on delete restrict,
  external_key text not null,
  seller_sku text,
  wb_sku text,
  name text not null,
  category_id uuid references core.categories(id) on delete restrict,
  brand_id uuid references core.brands(id) on delete restrict,
  status text not null default 'active',
  data_source text not null default 'import',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, cabinet_id),
  unique (cabinet_id, external_key),
  constraint products_external_key_not_blank check (btrim(external_key) <> ''),
  constraint products_name_not_blank check (btrim(name) <> ''),
  constraint products_identity_present check (nullif(btrim(seller_sku), '') is not null or nullif(btrim(wb_sku), '') is not null),
  constraint products_status_allowed check (status in ('active', 'archived')),
  constraint products_data_source_allowed check (data_source in ('import', 'manual', 'seed'))
);

create unique index products_cabinet_seller_sku_uq
on core.products (cabinet_id, seller_sku)
where nullif(btrim(seller_sku), '') is not null;

create unique index products_cabinet_wb_sku_uq
on core.products (cabinet_id, wb_sku)
where nullif(btrim(wb_sku), '') is not null;

create index products_category_idx on core.products (category_id, cabinet_id);
create index products_brand_idx on core.products (brand_id, cabinet_id);

create trigger core_products_set_updated_at
before update on core.products
for each row execute function app.set_updated_at();

create table core.product_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  cabinet_id uuid not null,
  alias_value text not null,
  alias_type text not null default 'historical',
  source_batch_id uuid references ingest.import_batches(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (product_id, cabinet_id) references core.products(id, cabinet_id) on delete cascade,
  unique (cabinet_id, alias_value),
  constraint product_aliases_value_not_blank check (btrim(alias_value) <> ''),
  constraint product_aliases_type_allowed check (alias_type in ('seller_sku', 'wb_sku', 'historical', 'manual'))
);

create index product_aliases_product_idx on core.product_aliases (product_id);

create table core.product_groups (
  id uuid primary key default gen_random_uuid(),
  cabinet_id uuid not null references core.cabinets(id) on delete restrict,
  external_key text not null,
  name text not null,
  is_ungrouped boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, cabinet_id),
  unique (cabinet_id, external_key),
  constraint product_groups_external_key_not_blank check (btrim(external_key) <> ''),
  constraint product_groups_name_not_blank check (btrim(name) <> '')
);

create unique index product_groups_one_ungrouped_per_cabinet_uq
on core.product_groups (cabinet_id)
where is_ungrouped;

create trigger core_product_groups_set_updated_at
before update on core.product_groups
for each row execute function app.set_updated_at();

create table core.group_membership_versions (
  id bigint generated always as identity primary key,
  product_id uuid not null,
  cabinet_id uuid not null,
  effective_date date not null,
  group_id uuid not null,
  source text not null default 'import',
  source_batch_id uuid references ingest.import_batches(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid references auth.users(id) on delete set null,
  foreign key (product_id, cabinet_id) references core.products(id, cabinet_id) on delete restrict,
  foreign key (group_id, cabinet_id) references core.product_groups(id, cabinet_id) on delete restrict,
  unique (product_id, effective_date),
  constraint group_membership_source_allowed check (source in ('import', 'manual', 'legacy'))
);

create index group_membership_versions_product_date_idx
on core.group_membership_versions (product_id, effective_date desc, id desc);

create index group_membership_versions_group_date_idx
on core.group_membership_versions (group_id, effective_date);

alter table core.brands enable row level security;
alter table core.categories enable row level security;
alter table core.products enable row level security;
alter table core.product_aliases enable row level security;
alter table core.product_groups enable row level security;
alter table core.group_membership_versions enable row level security;

create policy brands_read_allowed
on core.brands for select to authenticated
using (app.can_read());

create policy categories_read_allowed
on core.categories for select to authenticated
using (app.can_read());

create policy products_read_allowed
on core.products for select to authenticated
using (app.can_access_cabinet(cabinet_id));

create policy product_aliases_read_allowed
on core.product_aliases for select to authenticated
using (app.can_access_cabinet(cabinet_id));

create policy product_groups_read_allowed
on core.product_groups for select to authenticated
using (app.can_access_cabinet(cabinet_id));

create policy group_membership_versions_read_allowed
on core.group_membership_versions for select to authenticated
using (app.can_access_cabinet(cabinet_id));

grant select on core.brands, core.categories, core.products, core.product_aliases, core.product_groups, core.group_membership_versions to authenticated;

create or replace function public.v5_group_membership_at(
  p_product_id uuid,
  p_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cabinet_id uuid;
  v_membership record;
begin
  if auth.uid() is null or not app.can_read() or p_product_id is null or p_date is null then
    raise exception 'V5 read access, product and date are required';
  end if;

  select product.cabinet_id
  into v_cabinet_id
  from core.products product
  where product.id = p_product_id;

  if v_cabinet_id is null or not app.can_access_cabinet(v_cabinet_id) then
    raise exception 'Product is not available';
  end if;

  select membership.group_id, membership.effective_date, product_group.name, product_group.is_ungrouped
  into v_membership
  from core.group_membership_versions membership
  join core.product_groups product_group on product_group.id = membership.group_id
  where membership.product_id = p_product_id
    and membership.effective_date <= p_date
  order by membership.effective_date desc, membership.id desc
  limit 1;

  if v_membership.group_id is null then
    return jsonb_build_object(
      'product_id', p_product_id,
      'date', p_date,
      'known', false,
      'group_id', null,
      'group_name', null,
      'is_ungrouped', false,
      'effective_date', null
    );
  end if;

  return jsonb_build_object(
    'product_id', p_product_id,
    'date', p_date,
    'known', true,
    'group_id', v_membership.group_id,
    'group_name', v_membership.name,
    'is_ungrouped', v_membership.is_ungrouped,
    'effective_date', v_membership.effective_date
  );
end
$$;

revoke all on function public.v5_group_membership_at(uuid, date) from public, anon;
grant execute on function public.v5_group_membership_at(uuid, date) to authenticated;

create or replace function public.v5_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'environment', 'analytics-v5',
    'schema_version', '20260907008000',
    'status', 'ok'
  )
$$;

revoke all on function public.v5_health() from public;
grant execute on function public.v5_health() to anon, authenticated;

comment on function public.v5_group_membership_at(uuid, date) is 'Resolves the last known cabinet-scoped product group on a date; unknown before the first dated membership remains distinct from the explicit ungrouped group.';

commit;

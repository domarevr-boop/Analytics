-- Seed the two canonical V4 cabinets required by cabinet-routed V5 imports.

begin;

insert into core.cabinets (external_key, name, is_active)
values
  ('cab-1', 'Светпланет', true),
  ('cab-2', 'Ледситипро', true)
on conflict (external_key) do update
set
  name = excluded.name,
  is_active = true;

commit;

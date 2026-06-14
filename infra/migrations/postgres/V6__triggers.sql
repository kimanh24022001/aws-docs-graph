create or replace function app.create_personal_org()
returns trigger language plpgsql as $$
declare
  org_id uuid := gen_random_uuid();
begin
  insert into app.organizations(id, name, slug, is_personal)
  values (org_id, 'Personal', new.id::text, true);

  insert into app.org_memberships(org_id, user_id, role)
  values (org_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_user_created
  after insert on app.users
  for each row execute function app.create_personal_org();

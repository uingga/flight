-- Apply before deploying the contact inbox. Never expose inquiries to public clients.
create table if not exists public.contact_inquiries (
    id uuid primary key,
    category text not null check (category in ('question','error','suggestion','partnership')),
    name text not null default '',
    email text,
    message text not null check (char_length(message) <= 2000),
    attachment text check (octet_length(attachment) <= 1398200),
    status text not null default 'new' check (status in ('new','in_progress','resolved')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
alter table public.contact_inquiries enable row level security;
revoke all on public.contact_inquiries from public, anon, authenticated;
grant select, insert, update, delete on public.contact_inquiries to service_role;
create index if not exists contact_inquiries_created_idx on public.contact_inquiries(created_at desc);

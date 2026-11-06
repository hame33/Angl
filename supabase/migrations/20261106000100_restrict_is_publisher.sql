-- is_publisher() exists for the write policies, which only ever run as a
-- signed-in user. Nobody signed out has a reason to call it.
--
-- get_shared_clip() stays callable by anon on purpose: it is the share pages'
-- only read path. The advisor's warning about it is expected.
revoke execute on function public.is_publisher() from public, anon;
grant execute on function public.is_publisher() to authenticated;

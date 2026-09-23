-- Il trigger di immutabilita' delle firme non legge tabelle, ma un search_path
-- fisso toglie l'avviso del linter Supabase (function_search_path_mutable).
alter function public.quote_signatures_immutable() set search_path = public;

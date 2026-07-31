update public.profiles
set voice_names = case lower(full_name)
  when 'alexandros k' then array['Αλέξανδρος','Alexandros']
  when 'alexandra s' then array['Αλεξάνδρα','Alexandra']
  when 'agapi zoannou' then array['Αγάπη','Agapi']
  when 'chris bourtzoulas' then array['Chris','Χρήστος']
  when 'chara giannoula' then array['Χαρά','Chara']
  when 'dinos stavropoulos' then array['Ντίνος','Dinos']
  when 'fotis fotinias' then array['Φώτης','Fotis']
  when 'fang gao' then array['Φανή','Φανούλα','Fang']
  when 'galini stavropoulou' then array['Γκαλίνα','Γαλήνη','Galina','Galini']
  when 'ifigenia chrisoulaki' then array['Ιφιγένεια','Ifigenia']
  when 'john tzortzos' then array['John','Γιάννης','Tzortzos','Τζόρτζος']
  when 'maria tzortzou' then array['Μαρία','Maria']
  when 'ofeliya mirzoyan' then array['Οφέλια','Ofeliya']
  when 'sakis iliou' then array['Σάκης','Sakis']
  when 'vasilis katsaros' then array['Βασίλης','Vasilis']
  when 'victor stavropoulos' then array['Βίκτωρ','Victor']
  else voice_names
end,
aliases = '{}'
where lower(full_name) in (
  'alexandros k','alexandra s','agapi zoannou','chris bourtzoulas','chara giannoula',
  'dinos stavropoulos','fotis fotinias','fang gao','galini stavropoulou',
  'ifigenia chrisoulaki','john tzortzos','maria tzortzou','ofeliya mirzoyan',
  'sakis iliou','vasilis katsaros','victor stavropoulos'
);

comment on column public.profiles.voice_names is 'Recognized spoken or written name variants used by Mailo voice tools.';

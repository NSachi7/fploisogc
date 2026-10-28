-- Seed the 19-player pool. Safe to re-run: skips names that already exist.

insert into players (name, price)
select v.name, v.price
from (values
  ('Darsh', 11.0),
  ('Ishu', 11.0),
  ('Devu', 9.0),
  ('Vardaan', 8.0),
  ('Rudra', 7.5),
  ('Abhay', 7.0),
  ('Ari', 6.5),
  ('Chakra', 6.5),
  ('Sachi', 6.5),
  ('Jai', 6.0),
  ('Bamb', 5.5),
  ('Soni', 5.5),
  ('Gala', 5.0),
  ('Vedu', 5.0),
  ('Chody', 4.5),
  ('Santani', 4.5),
  ('Ahaan', 4.5),
  ('Avyaan', 4.0),
  ('Veer', 4.0)
) as v(name, price)
where not exists (select 1 from players p where p.name = v.name);

CREATE SEQUENCE "support_ticket_number_seq" START WITH 1 INCREMENT BY 1;

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS number
  FROM "support_requests"
)
UPDATE "support_requests" request
SET "ticket_number" = 'HSP' || lpad(numbered.number::text, 6, '0')
FROM numbered
WHERE request.id = numbered.id;

SELECT setval('"support_ticket_number_seq"', (SELECT COALESCE(MAX(row_number), 0) FROM (SELECT row_number() OVER (ORDER BY created_at ASC, id ASC) FROM "support_requests") numbered), true);

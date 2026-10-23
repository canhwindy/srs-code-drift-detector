const { Sequelize, QueryTypes } = require('sequelize');
const sequelize = new Sequelize(
  process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/outline',
  { logging: false }
);

async function debug() {
  const [total] = await sequelize.query(
    'SELECT COUNT(*) as count FROM attachments',
    { type: QueryTypes.SELECT }
  );
  console.log('Total attachments:', total.count);

  const [withDoc] = await sequelize.query(
    'SELECT COUNT(*) as count FROM attachments WHERE "documentId" IS NOT NULL',
    { type: QueryTypes.SELECT }
  );
  console.log('With documentId:', withDoc.count);

  const [noDoc] = await sequelize.query(
    'SELECT COUNT(*) as count FROM attachments WHERE "documentId" IS NULL',
    { type: QueryTypes.SELECT }
  );
  console.log('Without documentId (comments/avatars):', noDoc.count);

  // Check each attachment's orphan status
  const items = await sequelize.query(
    `SELECT a."id", a."key", a."createdAt", a."documentId", a."expiresAt",
            CASE WHEN d."text" LIKE '%' || CAST(a."id" AS TEXT) || '%'
                 THEN 'REFERENCED' ELSE 'ORPHANED' END as status
     FROM attachments a
     INNER JOIN documents d ON d."id" = a."documentId"
     WHERE a."documentId" IS NOT NULL AND a."expiresAt" IS NULL
     LIMIT 20`,
    { type: QueryTypes.SELECT }
  );

  console.log('\nAttachment status:');
  items.forEach(o => {
    console.log(`  [${o.status}] id=${o.id} created=${o.createdAt}`);
  });

  // Count actual orphans
  const [orphanCount] = await sequelize.query(
    `SELECT COUNT(*) as count
     FROM attachments a
     INNER JOIN documents d ON d."id" = a."documentId"
     WHERE a."documentId" IS NOT NULL
       AND a."expiresAt" IS NULL
       AND d."text" NOT LIKE '%' || CAST(a."id" AS TEXT) || '%'`,
    { type: QueryTypes.SELECT }
  );
  console.log('\nTotal orphaned:', orphanCount.count);

  await sequelize.close();
}

debug().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});

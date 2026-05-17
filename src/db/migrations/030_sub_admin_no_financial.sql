-- Sub-admins: full ops access via scopes, but no financial / revenue modules.

DELETE rp FROM role_permissions rp
INNER JOIN roles r ON r.id = rp.role_id
INNER JOIN permissions p ON p.id = rp.permission_id
WHERE r.code = 'SUB_ADMIN'
  AND p.code IN (
    'admin.monetization.read',
    'admin.monetization.write',
    'admin.transactions.read',
    'admin.analytics.read',
    'admin.reports.export'
  );

-- Ensure existing sub-admins can manage team + all operational modules.
INSERT IGNORE INTO sub_admin_scopes (sub_admin_user_id, scope_code)
SELECT ur.user_id, sc.scope_code
FROM user_roles ur
INNER JOIN roles r ON r.id = ur.role_id AND r.code = 'SUB_ADMIN'
CROSS JOIN (
  SELECT 'kyc' AS scope_code
  UNION SELECT 'support'
  UNION SELECT 'settings'
  UNION SELECT 'notifications'
  UNION SELECT 'moderation'
  UNION SELECT 'sub_admins'
) sc;

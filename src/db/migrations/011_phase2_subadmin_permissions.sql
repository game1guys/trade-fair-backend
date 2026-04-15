-- Phase 2 follow-up: allow SUB_ADMIN to access admin modules via scopes.
-- Permissions are still restricted by requireSubAdminScope().

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
INNER JOIN permissions p ON p.code LIKE 'admin.%'
WHERE r.code = 'SUB_ADMIN';


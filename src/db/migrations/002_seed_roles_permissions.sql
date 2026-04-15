INSERT IGNORE INTO roles (code, name, sort_order) VALUES
  ('SUPER_ADMIN', 'Super Admin', 1),
  ('SUB_ADMIN', 'Sub Admin', 2),
  ('ORGANIZER', 'Organizer', 3),
  ('EXHIBITOR', 'Exhibitor', 4),
  ('SERVICE_PROVIDER', 'Service Provider', 5),
  ('VISITOR', 'Visitor', 6);

INSERT IGNORE INTO permissions (code, description) VALUES
  ('auth.session', 'Manage own session'),
  ('admin.users.read', 'View users'),
  ('admin.users.write', 'Manage users');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'SUPER_ADMIN';

-- Every password change revokes existing JWTs, including operator SQL/tools.
CREATE FUNCTION revoke_sessions_on_password_change() RETURNS trigger AS $$
BEGIN
  IF NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash" THEN
    NEW."sessionVersion" := GREATEST(OLD."sessionVersion" + 1, NEW."sessionVersion");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_password_revokes_sessions
BEFORE UPDATE OF "passwordHash" ON "User"
FOR EACH ROW EXECUTE FUNCTION revoke_sessions_on_password_change();

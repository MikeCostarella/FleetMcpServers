-- civic_mcp_reader.sql — second gate behind dab-config.json.
-- Run in SSMS against OhioCivicData. Idempotent.
--
-- DAB running under your own Windows login already has full rights, so the
-- config is the only gate. If you ever run DAB as a service account or a SQL
-- login, point it at this role instead and the voter tables stay unreachable
-- even if the config is later widened by mistake.
--
-- Mirrors the grant list sketched in sql\001_schema.mssql.sql section 10.

IF DATABASE_PRINCIPAL_ID('civic_mcp_reader') IS NULL
    CREATE ROLE civic_mcp_reader;
GO

-- Public views (sql\001 section 9 and sql\027) -- the only surface the MCP sees
-- for anything that carries owner data or a GEOGRAPHY column
GRANT SELECT ON civic.v_parcel_public         TO civic_mcp_reader;
GRANT SELECT ON civic.v_precinct_summary      TO civic_mcp_reader;
GRANT SELECT ON civic.v_county_public         TO civic_mcp_reader;
GRANT SELECT ON civic.v_jurisdiction_public   TO civic_mcp_reader;
GRANT SELECT ON civic.v_place_public          TO civic_mcp_reader;
GRANT SELECT ON civic.v_boundary_public       TO civic_mcp_reader;
GRANT SELECT ON civic.v_school_public         TO civic_mcp_reader;

-- Reference tables
GRANT SELECT ON civic.land_use_code           TO civic_mcp_reader;
GRANT SELECT ON civic.income_tax              TO civic_mcp_reader;
GRANT SELECT ON civic.legislator              TO civic_mcp_reader;
GRANT SELECT ON civic.county_legislator       TO civic_mcp_reader;
GRANT SELECT ON civic.school_district         TO civic_mcp_reader;
GRANT SELECT ON civic.county_stat             TO civic_mcp_reader;
GRANT SELECT ON civic.county_vendor           TO civic_mcp_reader;
GRANT SELECT ON civic.info_link               TO civic_mcp_reader;
GRANT SELECT ON civic.election                TO civic_mcp_reader;
GRANT SELECT ON civic.county_election_source  TO civic_mcp_reader;
GRANT SELECT ON civic.source                  TO civic_mcp_reader;

-- Explicitly denied, belt and suspenders
DENY SELECT ON civic.voter                 TO civic_mcp_reader;
DENY SELECT ON civic.voter_election        TO civic_mcp_reader;
DENY SELECT ON civic.voter_contact         TO civic_mcp_reader;
DENY SELECT ON civic.voter_contact_source  TO civic_mcp_reader;
DENY SELECT ON civic.parcel                TO civic_mcp_reader;   -- owner_name / legal_description
DENY SELECT ON civic.parcel_polygon        TO civic_mcp_reader;
GO

-- Example: a SQL login for DAB to use instead of your Windows account.
-- CREATE LOGIN dab_civic WITH PASSWORD = '<strong password>';
-- CREATE USER  dab_civic FOR LOGIN dab_civic;
-- ALTER ROLE civic_mcp_reader ADD MEMBER dab_civic;
-- Connection string then becomes:
-- Server=localhost;Database=OhioCivicData;User Id=dab_civic;Password=...;TrustServerCertificate=True;Encrypt=False

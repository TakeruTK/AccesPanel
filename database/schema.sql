-- Esquema inicial para sistema de control de acceso
-- Dialecto objetivo: PostgreSQL

CREATE TABLE roles (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL UNIQUE,
    description TEXT
);

INSERT INTO roles (code, name, description) VALUES
('ADMIN', 'Administrador', 'Puede crear usuarios y administrar todo el sistema'),
('TICKET_CREATOR', 'Creador de ticket', 'Puede registrar tickets y responder solicitudes del operador'),
('TICKET_VERIFIER', 'Verificador de ticket', 'Puede aprobar, observar o rechazar tickets'),
('OPERATOR', 'Operador', 'Puede validar ingreso y registrar entrada y salida');

CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    role_id SMALLINT NOT NULL REFERENCES roles(id),
    username VARCHAR(60) NOT NULL UNIQUE,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE companies (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    tax_id VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE people (
    id BIGSERIAL PRIMARY KEY,
    rut VARCHAR(12) NOT NULL UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    company_id BIGINT REFERENCES companies(id),
    document_number VARCHAR(30),
    phone VARCHAR(30),
    email VARCHAR(150),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ticket_statuses (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL UNIQUE
);

INSERT INTO ticket_statuses (code, name) VALUES
('BORRADOR', 'Borrador'),
('PENDIENTE_VERIFICACION', 'Pendiente verificacion'),
('OBSERVADO', 'Observado'),
('APROBADO', 'Aprobado'),
('RECHAZADO', 'Rechazado'),
('EN_PROCESO_INGRESO', 'En proceso de ingreso'),
('INGRESADO', 'Ingresado'),
('SALIDA_REGISTRADA', 'Salida registrada'),
('VENCIDO', 'Vencido'),
('CANCELADO', 'Cancelado');

CREATE TABLE access_tickets (
    id BIGSERIAL PRIMARY KEY,
    ticket_code VARCHAR(30) NOT NULL UNIQUE,
    person_id BIGINT NOT NULL REFERENCES people(id),
    company_id BIGINT REFERENCES companies(id),
    host_name VARCHAR(150) NOT NULL,
    activity_description TEXT NOT NULL,
    scheduled_entry_at TIMESTAMP NOT NULL,
    scheduled_exit_at TIMESTAMP NOT NULL,
    status_id SMALLINT NOT NULL REFERENCES ticket_statuses(id),
    creator_user_id BIGINT NOT NULL REFERENCES users(id),
    verifier_user_id BIGINT REFERENCES users(id),
    verification_notes TEXT,
    rejection_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_ticket_schedule CHECK (scheduled_exit_at > scheduled_entry_at)
);

CREATE TABLE ticket_status_history (
    id BIGSERIAL PRIMARY KEY,
    ticket_id BIGINT NOT NULL REFERENCES access_tickets(id),
    previous_status_id SMALLINT REFERENCES ticket_statuses(id),
    new_status_id SMALLINT NOT NULL REFERENCES ticket_statuses(id),
    changed_by_user_id BIGINT NOT NULL REFERENCES users(id),
    notes TEXT,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE access_event_types (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL UNIQUE
);

INSERT INTO access_event_types (code, name) VALUES
('CHECK_IN', 'Entrada'),
('CHECK_OUT', 'Salida'),
('DENIED', 'Ingreso denegado'),
('LOOKUP', 'Consulta de acceso');

CREATE TABLE access_sources (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL UNIQUE
);

INSERT INTO access_sources (code, name) VALUES
('RUT', 'Busqueda por RUT'),
('CARD_SCAN', 'Escaneo de carnet'),
('MANUAL', 'Registro manual');

CREATE TABLE access_events (
    id BIGSERIAL PRIMARY KEY,
    ticket_id BIGINT REFERENCES access_tickets(id),
    person_id BIGINT NOT NULL REFERENCES people(id),
    operator_user_id BIGINT NOT NULL REFERENCES users(id),
    event_type_id SMALLINT NOT NULL REFERENCES access_event_types(id),
    source_id SMALLINT NOT NULL REFERENCES access_sources(id),
    observed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

CREATE TABLE operator_request_statuses (
    id SMALLSERIAL PRIMARY KEY,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL UNIQUE
);

INSERT INTO operator_request_statuses (code, name) VALUES
('PENDIENTE_RESPUESTA', 'Pendiente respuesta'),
('EN_REVISION', 'En revision'),
('APROBADA', 'Aprobada'),
('RECHAZADA', 'Rechazada'),
('CERRADA', 'Cerrada');

CREATE TABLE operator_access_requests (
    id BIGSERIAL PRIMARY KEY,
    person_id BIGINT REFERENCES people(id),
    related_ticket_id BIGINT REFERENCES access_tickets(id),
    requested_rut VARCHAR(12) NOT NULL,
    requested_first_name VARCHAR(100) NOT NULL,
    requested_last_name VARCHAR(100) NOT NULL,
    company_name VARCHAR(150),
    host_name VARCHAR(150),
    activity_description TEXT,
    desired_entry_at TIMESTAMP,
    desired_exit_at TIMESTAMP,
    operator_notes TEXT,
    status_id SMALLINT NOT NULL REFERENCES operator_request_statuses(id),
    operator_user_id BIGINT NOT NULL REFERENCES users(id),
    responded_by_user_id BIGINT REFERENCES users(id),
    response_notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP,
    CONSTRAINT chk_operator_request_schedule
        CHECK (desired_exit_at IS NULL OR desired_entry_at IS NULL OR desired_exit_at > desired_entry_at)
);

CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id),
    entity_type VARCHAR(60) NOT NULL,
    entity_id BIGINT,
    action VARCHAR(80) NOT NULL,
    details JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_people_rut ON people(rut);
CREATE INDEX idx_tickets_person ON access_tickets(person_id);
CREATE INDEX idx_tickets_status ON access_tickets(status_id);
CREATE INDEX idx_tickets_schedule ON access_tickets(scheduled_entry_at, scheduled_exit_at);
CREATE INDEX idx_access_events_person_time ON access_events(person_id, observed_at);
CREATE INDEX idx_operator_requests_status ON operator_access_requests(status_id);

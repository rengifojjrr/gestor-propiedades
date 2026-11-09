import { vi } from "vitest";

// El paquete `server-only` lanza fuera de un Server Component: en las pruebas se simula.
vi.mock("server-only", () => ({}));

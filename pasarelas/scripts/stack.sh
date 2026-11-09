#!/usr/bin/env bash
# Stack local de Supabase para Pasarelas (Postgres, Auth, API, Storage y correo de pruebas), con Docker.
#
#   bash scripts/stack.sh start    levanta Docker si está caído y el stack; escribe .env.local si falta
#   bash scripts/stack.sh stop     detiene el stack (los datos locales se conservan)
#   bash scripts/stack.sh reset    vuelve a crear la base local aplicando supabase/migrations (BORRA los datos locales)
#   bash scripts/stack.sh status   muestra el estado
#   bash scripts/stack.sh env      escribe .env.local con la URL y las claves del stack local en marcha
#   bash scripts/stack.sh types    regenera src/lib/supabase/database.types.ts desde la base local
#
# Solo toca la base LOCAL. Nunca se conecta a un proyecto remoto.
set -euo pipefail

cd "$(dirname "$0")/.."

# Servicios que la app no usa: no se levantan (arranque más rápido y menos memoria).
EXCLUIDOS="studio,logflare,vector,realtime,edge-runtime,imgproxy,supavisor"
SUPABASE="npx --no-install supabase"

asegurar_docker() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  if ! command -v dockerd >/dev/null 2>&1; then
    echo "Docker no responde. Abre Docker Desktop (o inicia el servicio) y vuelve a intentar." >&2
    exit 1
  fi
  # Contenedores de desarrollo sin servicio de Docker: se arranca el demonio a mano.
  local log="${TMPDIR:-/tmp}/pasarelas-dockerd.log"
  echo "Docker no está corriendo: lo arranco (registro en $log)…"
  (setsid nohup dockerd >"$log" 2>&1 </dev/null &)
  for _ in $(seq 1 30); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Docker no arrancó. Revisa $log" >&2
  exit 1
}

en_marcha() {
  $SUPABASE status >/dev/null 2>&1
}

escribir_env() {
  local salida url publicable secreta
  salida="$($SUPABASE status -o env 2>/dev/null)"
  url="$(printf '%s\n' "$salida" | sed -n 's/^API_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' | head -1)"
  publicable="$(printf '%s\n' "$salida" | sed -n 's/^PUBLISHABLE_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' | head -1)"
  secreta="$(printf '%s\n' "$salida" | sed -n 's/^SECRET_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' | head -1)"
  if [ -z "$url" ] || [ -z "$publicable" ] || [ -z "$secreta" ]; then
    echo "No pude leer la URL y las claves del stack local (¿está en marcha?)." >&2
    exit 1
  fi
  {
    echo "# Generado por scripts/stack.sh a partir del stack LOCAL. No se versiona."
    echo "NEXT_PUBLIC_SUPABASE_URL=$url"
    echo "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$publicable"
    echo "# Solo para pruebas de integración, punta a punta y la semilla. La app nunca la usa."
    echo "SUPABASE_SECRET_KEY=$secreta"
  } >.env.local
  echo ".env.local escrito (stack local: $url)"
}

iniciar() {
  asegurar_docker
  if en_marcha; then
    echo "El stack local ya está en marcha."
  else
    local intento
    for intento in 1 2 3; do
      if $SUPABASE start -x "$EXCLUIDOS"; then
        break
      fi
      if [ "$intento" = 3 ]; then
        echo "El stack local no arrancó después de 3 intentos." >&2
        exit 1
      fi
      echo "Intento $intento fallido (suele ser el límite de descargas del registro de imágenes). Reintento en 20 s…"
      sleep 20
    done
  fi
  if [ ! -f .env.local ]; then
    escribir_env
  fi
}

case "${1:-}" in
  start)
    iniciar
    ;;
  stop)
    $SUPABASE stop
    ;;
  reset)
    iniciar
    $SUPABASE db reset
    ;;
  status)
    asegurar_docker
    $SUPABASE status
    ;;
  env)
    asegurar_docker
    escribir_env
    ;;
  types)
    iniciar
    mkdir -p src/lib/supabase
    $SUPABASE gen types typescript --local --schema public >src/lib/supabase/database.types.ts.tmp
    mv src/lib/supabase/database.types.ts.tmp src/lib/supabase/database.types.ts
    echo "Tipos regenerados en src/lib/supabase/database.types.ts"
    ;;
  *)
    echo "Uso: bash scripts/stack.sh start|stop|reset|status|env|types" >&2
    exit 2
    ;;
esac

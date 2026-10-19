# Gambeta Auriverde TV (`TvAppGambeta`)

Plataforma privada de televisión y señales deportivas en vivo para el club **Gambeta Auriverde**.

## Características
- **Acceso privado por número de teléfono**: cada miembro autorizado ingresa con su número de celular.
- **Panel Admin CRUD (`/api/admin/*`)**: gestión en tiempo real de amigos autorizados (agregar, editar, pausar, eliminar, importar/exportar JSON) protegido con PIN Maestro.
- **Señales Deportivas Web (La18HD) + Listas M3U (IPTV Nexus 8.4K, Deportes y Países)**: reproductor híbrido HLS e iframe embebido.
- **Modo Claro y Modo Oscuro**: identidad visual oficial Auriverde (`#FDD003`, `#027F31`, `#FE0000`, `#000000`, `#FFFFFF`).

## Ejecución
```bash
node server.js
```
Por defecto corre en el puerto `5500` (configurable mediante la variable de entorno `PORT`).

import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [index("routes/board.tsx"), route("kit", "routes/kit.tsx")] satisfies RouteConfig;

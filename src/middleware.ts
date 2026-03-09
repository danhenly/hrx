import {
    convexAuthNextjsMiddleware,
    createRouteMatcher,
    nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isPublicRoute = createRouteMatcher([
    "/",
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/invite(.*)",
    "/landing(.*)",
    "/status-page(.*)",
]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
    const isAuthenticated = await convexAuth.isAuthenticated();

    // Redirect unauthenticated users trying to access protected routes
    if (!isPublicRoute(request) && !isAuthenticated) {
        return nextjsMiddlewareRedirect(request, "/sign-in");
    }

    // Redirect authenticated users away from auth pages
    if (
        (request.nextUrl.pathname.startsWith("/sign-in") ||
            request.nextUrl.pathname.startsWith("/sign-up")) &&
        isAuthenticated
    ) {
        return nextjsMiddlewareRedirect(request, "/dashboard");
    }
});

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};

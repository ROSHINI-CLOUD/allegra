import { httpRouter } from 'convex/server';

import { auth } from './auth';

/** Convex Auth's OAuth callback and token endpoints. Without these, Google sign-in has nowhere to land. */
const http = httpRouter();
auth.addHttpRoutes(http);

export default http;

import { handlers } from "@/lib/auth";
import { credentialsResponse } from "@/lib/credentialsGuard";
import type { NextRequest } from "next/server";

export const { GET } = handlers;
export const POST = (req: NextRequest) => credentialsResponse(req, () => handlers.POST(req));

import { redirect } from "next/navigation";

// Root: send everyone to the dashboard. Auth middleware redirects to /login
// when there's no session.
export default function Home() {
  redirect("/targets");
}

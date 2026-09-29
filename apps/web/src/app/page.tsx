import { redirect } from "next/navigation";

// The landing page arrives in build step 5; until then the root opens the app.
export default function Home() {
  redirect("/app");
}

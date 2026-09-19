import { Workbench } from "@/components/Workbench";

export default function HomePage() {
  return <Workbench mapTilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY ?? ""} />;
}

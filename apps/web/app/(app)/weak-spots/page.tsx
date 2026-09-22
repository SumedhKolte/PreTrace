"use client";

import { Gauge } from "lucide-react";
import { KitPicker } from "@/components/kit/kit-picker";

export default function WeakSpotsHubPage() {
  return <KitPicker title="Weak Spots" description="Your least-ready kits first. Open one to see its weak spots and start a targeted repair." suffix="weak-spots" icon={<Gauge />} cta="Open coach" />;
}

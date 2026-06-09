import { redirect } from 'next/navigation';

export const metadata = {
  title: 'DashClaw Live Demo',
  description: 'Interactive DashClaw governance demo with deterministic proof artifacts.',
};

export default function DemoPage() {
  redirect('/#live-demo');
}

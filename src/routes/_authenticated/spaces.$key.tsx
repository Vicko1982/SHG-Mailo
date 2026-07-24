import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSpaces } from "@/lib/spaces.functions";
import { TaskList } from "@/components/task-list";

export const Route = createFileRoute("/_authenticated/spaces/$key")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.key} — Smart Homes Task Manager` },
      { name: "description", content: `Tasks in ${params.key} space.` },
    ],
  }),
  component: SpacePage,
});

function SpacePage() {
  const { key } = Route.useParams();
  const fetchSpaces = useServerFn(listSpaces);
  const { data: spaces = [] } = useQuery({
    queryKey: ["spaces"],
    queryFn: () => fetchSpaces(),
  });
  const space = spaces.find((s) => s.key === key);
  return <TaskList spaceKey={key} scope="all" title={space?.name ?? key} spaceColor={space?.color} />;
}

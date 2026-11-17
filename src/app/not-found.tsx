import { ButtonLink, PageTitle } from "@/components/ui";

export default function NotFound() {
  return (
    <div>
      <PageTitle title="Not found" kicker="404">
        That page or medicine does not exist (it may have been removed).
      </PageTitle>
      <ButtonLink href="/">Back home</ButtonLink>
    </div>
  );
}

# Shared videos

Drop the team's clips here (`.mp4`, `.webm`, `.mov`, `.mkv`). They appear in the
Library for everyone, and the admin assigns them to members. Nothing is uploaded
— the server reads them straight from this folder on the host machine.

## The folders are the types

The first folder a clip sits in is its **type** in the Library's Type filter:

```
video/
  30s clips/    0001.mp4 … 1050.mp4                digits only
  gt/           009067472_8f16bc….mp4, gt_0092….mp4  an ID, gt_ optional
  Full match/   Veo - Match - 1st XI football-clip 1.mp4, …   everything else
```

You don't have to sort them yourself. Drop clips straight into `video/` and run
`npm run sort-videos` — or just `npm run build`, which runs it at the end. Each
loose clip goes into its folder by the rule above. Use `npm run sort-videos --
--dry-run` to see what would move first.

It only moves clips that are loose at the top of this folder. A clip that's
already in a folder is never touched, so to give one a different type, move it
into another folder by hand and it stays there. Any other folder you make here
becomes a type of its own. Nothing is overwritten or deleted, and a clip that is
open in somebody's browser is left where it is and picked up next time.

Ground truth and review files match clips **by name**, so moving a video between
folders never needs anything else moved with it.

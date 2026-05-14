# NAM Lab Workflows

This guide focuses on practical workflows rather than feature lists. Use it when you know what kind of cleanup you want to do but are not sure which tool path fits best.

For the full feature inventory, see [features.md](features.md).

---

## 1. Build a cleaner library from a messy parent root

![Library cleanup preview](images/library-cleanup-preview.png)

Use this when you have:
- downloads scattered across many folders
- a staging area
- a broad intake folder
- multiple creator folders that are not consistently organized

Open:
- **Library Tools -> Clean Up / Build Library...**

Recommended first pass:
1. Pick a broad parent root that contains the captures you want to collect.
2. Pick a destination library root.
3. Leave the action on `Copy` for the first serious run.
4. Choose a structure:
   - `Creator`
   - `Creator > Amp`
   - `Creator > Amp > DI/CAB`
   - `Creator > Amp > DI/CAB > Preset Type`
5. Build the preview.
6. Check:
   - `Ready`
   - `Needs Review`
   - `No Change`
7. Export the `Needs Review` list if you want to fix that subset later.
8. When the preview looks right, run the cleanup.

Recommended mindset:
- use top-level cleanup when the source is broad or mixed
- use `Copy` first when testing structure
- treat `Needs Review` as a staging bucket, not as failure

---

## 2. Clean one folder or subtree in place

Use this when you already trust the folder you are looking at and want to organize it more deeply.

Examples:
- a creator folder
- a specific amp folder
- a flat DI folder
- a repaired `Needs Review` bucket

Open:
- right-click folder -> **Clean this folder...**

How it behaves:
- the selected folder becomes an **anchor**
- matching creator / amp path segments already represented by that folder are not rebuilt inside it again

That means if you are already inside:
- `2dor/Mesa Boogie Mark VII`

and you clean that folder with a deeper structure, NAM Lab should build:
- `DI/...`
- `CAB/...`
- preset-type folders

instead of creating another nested:
- `2dor/Mesa Boogie Mark VII/...`

Use this when the folder is mostly homogeneous and you want to deepen the organization, not rebuild the whole library.

---

## 3. Repair files in `Needs Review` and recategorize them

This is one of the most important workflows in the app.

Typical flow:
1. Run a broad cleanup.
2. Let uncertain files land in `Needs Review`.
3. Batch-edit or individually fix the missing metadata.
4. Right-click `Needs Review`.
5. Choose **Clean this folder...**
6. Let the destination point to the **parent library root**.
7. Run cleanup again.

Expected result:
- repaired files move back out of `Needs Review`
- they land as deeply as the now-correct metadata allows

This is often the fastest way to process large messy imports:
- one broad pass
- one metadata repair pass
- one focused recategorize pass

---

## 4. Repair placeholder metadata like `tz-make` / `tz-model`

This is common with imported Tone3000 captures and other incomplete uploads.

Typical problem:
- files land under a junk subtree such as:
  - `amalgamaudio/tz-make tz-model/di`

You then fix the metadata so they really belong under:
- `amalgamaudio/gibson g200/di`

The key choice is the destination root:
- set **Destination Library Root** to `amalgamaudio`
- not to `tz-make tz-model`
- not to the current `di` folder

Why:
- the currently selected folder acts like an anchor
- leaving the destination on the junk subtree tells NAM Lab to keep building under that branch

So the rule of thumb is:
- if the current subtree name is wrong, point cleanup to the **parent branch you want to keep**

---

## 5. Use metadata suggestions for structured filename styles

![Metadata editor and context tools](images/metadata-editor.png)

Use this when the files themselves are named consistently even if the metadata is not.

Good fit:
- one creator's naming style
- one pack with repeated segment structure
- a batch you downloaded that uses the same conventions

Open:
- right-click folder -> **Edit folder suggestion rules...**
- or use global rules for patterns that are library-wide

Tools to know:
- **Suggest metadata...**
- **Build from example...**
- rule library
- overwrite guards

Example naming style:
- `JCM800 Lo P6 B8 M4 T7 G10`

Possible meaning:
- `JCM800` -> make/model
- `Lo` -> amp switch
- `P6 B8 M4 T7 G10` -> amp settings

This works best when the naming style is consistent across a set of files.

---

## 6. Choose between global rules and folder rules

Use **global rules** when:
- the token meaning is stable everywhere
- example: `Mesa` almost always means a Mesa cabinet in your whole library

Use **folder rules** when:
- the meaning changes by creator or batch
- example: inside one creator subtree, `Mesa` means the amp make, not the cabinet

Folder rules override global token meaning in that subtree.

That makes folder-scoped repair much safer than relying only on one giant global ruleset.

---

## 7. Use overwrite rules carefully

Normal suggestion rules only fill blank fields.

Use **Overwrite** when:
- you know the field contains junk placeholder values
- you want the rule to repair that field even though it is not empty

Best practice:
- guard overwrite rules to only hit known junk values like:
  - `tz-make`
  - `tz-model`
  - `Unknown`
  - `N/A`

That gives you repair power without turning every overwrite into a broad hammer.

---

## 8. Use duplicate modes intentionally when names are unreliable

If filenames and metadata names are inconsistent, pick the duplicate mode that matches the question you are actually asking.

Use **Content** when you want:
- hashes the full `.nam` file
- finds true byte-for-byte duplicates

Use:
- `Filename` mode when you want same-name cleanup
- `Meta Name` when you care about the embedded capture name
- `Content` when you want exact duplicate files regardless of names
- `Same Model, Metadata Differs` when you want to find captures whose underlying model matches but one copy has cleaner or repaired metadata

That last mode is especially useful during metadata cleanup when you suspect you have:
- one file with placeholder metadata such as `tz-make` / `tz-model`
- and another copy of the same capture whose metadata has already been corrected

---

## 9. Suggested first-time cleanup strategy

If you are starting from a very messy library:

1. Run top-level cleanup in `Copy` mode.
2. Review `Needs Review`.
3. Batch-fix obvious creator / make / model issues.
4. Use folder-scoped rules for creator-specific meaning.
5. Re-run cleanup on `Needs Review`.
6. Use duplicate detection after structure is mostly sane.
7. Only switch to `Move` when you trust the pattern.

This tends to be the least stressful path and gives you easy checkpoints if something unexpected shows up.

---

## 10. Tone3000-assisted intake workflow

![Tone3000 browser inside NAM Lab](images/tone3000-browser.png)

If you are actively collecting new captures from Tone3000, a practical flow is:

1. Browse and download captures inside NAM Lab.
2. Let them land in a staging or intake area.
3. Run top-level cleanup in `Copy` mode first.
4. Fix any `Needs Review` items.
5. Re-run cleanup on the repaired subset.

This tends to keep downloading, tagging, and final library organization in one place instead of bouncing between several tools.

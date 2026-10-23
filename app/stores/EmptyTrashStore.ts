import { observable, action, computed } from "mobx";
import { t } from "i18next";
import { toast } from "sonner";
import { client } from "~/utils/ApiClient";
import type RootStore from "./RootStore";

class EmptyTrashStore {
  rootStore: RootStore;

  @observable
  isEmptying = false;

  @observable
  isComplete = false;

  @observable
  progress = 0;

  @observable
  processedCount = 0;

  @observable
  totalCount = 0;

  @observable
  error: string | null = null;

  constructor(rootStore: RootStore) {
    this.rootStore = rootStore;
  }

  @computed
  get isActive(): boolean {
    return this.isEmptying && !this.isComplete;
  }

  @action
  startEmptying = async () => {
    if (this.isEmptying) {
      return;
    }

    const { documents } = this.rootStore;

    this.isEmptying = true;
    this.isComplete = false;
    this.error = null;
    this.processedCount = 0;
    this.progress = 5;

    try {
      // Server deletes ALL trash documents (not just the loaded page)
      // and returns the total count
      const res = await client.post("/documents.empty_trash");
      const serverTotal = res.data?.deletedCount ?? 0;

      this.setTotalCount(serverTotal || documents.deleted.length);

      // Animate progress based on server total
      const steps = Math.min(this.totalCount, 30);
      const batchSize = Math.max(1, Math.ceil(this.totalCount / steps));

      for (let i = 0; i < this.totalCount; i += batchSize) {
        const done = Math.min(i + batchSize, this.totalCount);
        this.setProcessedCount(done);
        this.setProgress(Math.round(5 + (done / this.totalCount) * 90));
        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      // Force-purge all deleted docs from client store.
      // Must use purgeDeleted() because the normal remove() on ParanoidModel
      // only sets deletedAt (which these docs already have) — it does NOT
      // remove them from the data map, so they'd remain visible.
      documents.purgeDeleted();

      this.setProgress(100);
      this.setComplete(true);
      toast.success(
        t("Trash emptied – {{count}} documents permanently deleted", {
          count: this.totalCount,
        })
      );
    } catch (err: any) {
      this.setError(err.message || t("Failed to empty trash"));
      this.setComplete(true);
      toast.error(
        t("Failed to empty trash: {{error}}", { error: err.message })
      );
    } finally {
      this.setIsEmptying(false);
    }
  };

  @action
  private setProgress = (value: number) => {
    this.progress = value;
  };

  @action
  private setProcessedCount = (value: number) => {
    this.processedCount = value;
  };

  @action
  private setTotalCount = (value: number) => {
    this.totalCount = value;
  };

  @action
  private setComplete = (value: boolean) => {
    this.isComplete = value;
  };

  @action
  private setIsEmptying = (value: boolean) => {
    this.isEmptying = value;
  };

  @action
  private setError = (value: string | null) => {
    this.error = value;
  };

  @action
  reset = () => {
    this.isEmptying = false;
    this.isComplete = false;
    this.progress = 0;
    this.processedCount = 0;
    this.totalCount = 0;
    this.error = null;
  };
}

export default EmptyTrashStore;

import { observable } from "mobx";
import type BADashboardStore from "~/stores/BADashboardStore";
import ParanoidModel from "./base/ParanoidModel";
import Field from "./decorators/Field";

/**
 * Represents a BA Dashboard item.
 */
export default class BADashboard extends ParanoidModel {
    static modelName = "BADashboard";

    store: BADashboardStore;

    /** The title of the dashboard item. */
    @Field
    @observable
    title: string;

    /** The description of the dashboard item. */
    @Field
    @observable
    description?: string;

    /** The type of the dashboard item (chart, table, metric, etc.). */
    @Field
    @observable
    type: string;

    /** The configuration for the dashboard item (JSON). */
    @Field
    @observable
    config?: Record<string, unknown>;

    /** The data source URL or identifier. */
    @Field
    @observable
    dataSource?: string;

    /** The sort index for ordering. */
    @Field
    @observable
    index: string;

    /** The ID of the user who created this item. */
    @Field
    @observable
    createdById: string;

    /** The ID of the team this belongs to. */
    @Field
    @observable
    teamId: string;
}

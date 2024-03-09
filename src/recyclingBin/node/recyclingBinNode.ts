import { NodeTypes, OutlineNode } from "../../outline/node";


export class RecyclingBinNode extends OutlineNode {

    getChildren = async (filter: boolean): Promise<OutlineNode[]> => {
        return super.getChildren(filter);
    }

    constructor(data: NodeTypes) {
        super(data);
    }
}
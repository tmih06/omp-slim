// Preserve the model-type guard from the upstream Biome plugin.

export default {
	meta: { name: "omp-slim" },
	rules: {
		"model-type-comparison": {
			meta: {
				type: "problem",
				schema: [],
				messages: {
					chat: "Chat models may omit type. Use isModelType(model, 'chat') or getModelType(model) instead of comparing type to 'chat'.",
				},
			},
			create(context) {
				return {
					BinaryExpression(node) {
						if (!["===", "!==", "==", "!="].includes(node.operator)) return;
						for (const [member, literal] of [
							[node.left, node.right],
							[node.right, node.left],
						]) {
							if (
								member.type === "MemberExpression" &&
								!member.computed &&
								member.property.name === "type" &&
								literal.type === "Literal" &&
								literal.value === "chat"
							) {
								context.report({ node, messageId: "chat" });
								return;
							}
						}
					},
				};
			},
		},
	},
};

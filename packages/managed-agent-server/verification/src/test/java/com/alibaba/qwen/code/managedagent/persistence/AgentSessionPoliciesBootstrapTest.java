package com.alibaba.qwen.code.managedagent.persistence;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AgentSessionPoliciesBootstrapTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    private static ObjectNode receipt() {
        ObjectNode node = JSON.createObjectNode();
        node.put("operationId", "90fd4881-1668-5edd-9d70-d10130de117e");
        node.put("actorKey", "90fd488116680edd5d70d10130de117e678a9529abe085dc064036502fd9b82e");
        node.put("expectedRevision", 0);
        var extensions = node.putArray("extensions");
        extensions.addObject().put("extensionId", "ext_1").put("packageRevision", 1).put("packageDigest", "abc");
        return node;
    }

    @Test
    void replayWithModeApplyMatchesCreationReceipt() {
        ObjectNode replay = receipt();
        replay.put("mode", "apply");
        assertThat(AgentSessionPolicies.isInitialBootstrapCommand(receipt(), replay)).isTrue();
    }

    @Test
    void exactReceiptWithoutModeMatches() {
        assertThat(AgentSessionPolicies.isInitialBootstrapCommand(receipt(), receipt())).isTrue();
    }

    @Test
    void missingFieldIsRejected() {
        ObjectNode incomplete = receipt();
        incomplete.remove("extensions");
        assertThat(AgentSessionPolicies.isInitialBootstrapCommand(receipt(), incomplete)).isFalse();
    }

    @Test
    void emptyObjectIsRejected() {
        assertThat(AgentSessionPolicies.isInitialBootstrapCommand(receipt(), JSON.createObjectNode())).isFalse();
    }

    @Test
    void extraFieldBeyondModeIsRejected() {
        ObjectNode extra = receipt();
        extra.put("mode", "apply");
        extra.put("surprise", "field");
        assertThat(AgentSessionPolicies.isInitialBootstrapCommand(receipt(), extra)).isFalse();
    }

    @Test
    void wrongModeIsRejected() {
        ObjectNode wrongMode = receipt();
        wrongMode.put("mode", "recoverPrevious");
        assertThat(AgentSessionPolicies.isInitialBootstrapCommand(receipt(), wrongMode)).isFalse();
    }

    @Test
    void differentFieldValueIsRejected() {
        ObjectNode tampered = receipt();
        tampered.put("mode", "apply");
        tampered.put("expectedRevision", 1);
        assertThat(AgentSessionPolicies.isInitialBootstrapCommand(receipt(), tampered)).isFalse();
    }
}

from langgraph.graph import END, StateGraph

from app.agents.nodes.format import format_node
from app.agents.nodes.graph_traverse import graph_traverse_node
from app.agents.nodes.mcp_read import mcp_read_node
from app.agents.nodes.mcp_search import mcp_search_node
from app.agents.nodes.plan import plan_node
from app.agents.nodes.synthesize import synthesize_node
from app.agents.state import AgentState


def build_graph():
    g = StateGraph(AgentState)

    g.add_node("plan", plan_node)
    g.add_node("mcp_search", mcp_search_node)
    g.add_node("graph_traverse", graph_traverse_node)
    g.add_node("mcp_read", mcp_read_node)
    g.add_node("synthesize", synthesize_node)
    g.add_node("format", format_node)

    g.set_entry_point("plan")
    g.add_edge("plan", "mcp_search")
    g.add_edge("mcp_search", "graph_traverse")
    g.add_edge("graph_traverse", "mcp_read")
    g.add_edge("mcp_read", "synthesize")
    g.add_edge("synthesize", "format")
    g.add_edge("format", END)

    return g.compile()


graph = build_graph()

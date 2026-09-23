use super::*;

type Objects = BTreeMap<tg::object::Id, tg::Object>;

fn object(id: &tg::object::Id, objects: &Objects) -> tg::Object {
	objects
		.get(id)
		.cloned()
		.unwrap_or_else(|| tg::Object::with_id(id.clone()))
}

// Replace deserialized references with the original dependency handles, including their state.
pub(super) fn template(template: &mut tg::Template, objects: &Objects) -> tg::Result<()> {
	for component in &mut template.components {
		if let tg::template::Component::Artifact(artifact) = component {
			*artifact = object(&artifact.id().into(), objects).try_into()?;
		}
	}
	Ok(())
}

fn value(value: &mut tg::Value, objects: &Objects) -> tg::Result<()> {
	match value {
		tg::Value::Object(handle) => *handle = object(&handle.id(), objects),
		tg::Value::Template(value) => template(value, objects)?,
		tg::Value::Mutation(value) => mutation(value, objects)?,
		tg::Value::Array(values) => {
			for item in values {
				self::value(item, objects)?;
			}
		},
		tg::Value::Map(values) => {
			for item in values.values_mut() {
				self::value(item, objects)?;
			}
		},
		tg::Value::Module(module) => {
			if let tg::module::Source::Edge(edge) = &mut module.referent.node {
				match edge {
					tg::graph::Edge::Object(handle) => *handle = object(&handle.id(), objects),
					tg::graph::Edge::Pointer(pointer) => {
						if let Some(graph) = &mut pointer.graph {
							*graph = object(&graph.id().into(), objects)
								.try_unwrap_graph()
								.map_err(|_| tg::error!("expected a graph"))?;
						}
					},
				}
			}
		},
		_ => {},
	}
	Ok(())
}

pub(super) fn mutation(mutation: &mut tg::Mutation, objects: &Objects) -> tg::Result<()> {
	match mutation {
		tg::Mutation::Unset => {},
		tg::Mutation::Set { value: item } | tg::Mutation::SetIfUnset { value: item } => {
			value(item, objects)?;
		},
		tg::Mutation::Prepend { values } | tg::Mutation::Append { values } => {
			for item in values {
				value(item, objects)?;
			}
		},
		tg::Mutation::Prefix { template: item, .. }
		| tg::Mutation::Suffix { template: item, .. } => template(item, objects)?,
		tg::Mutation::Merge { value: values } => {
			for item in values.values_mut() {
				value(item, objects)?;
			}
		},
	}
	Ok(())
}
